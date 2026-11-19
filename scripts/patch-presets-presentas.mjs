#!/usr/bin/env node
// Notara presets 兼容补丁：dsh 0.2.2-rc.1 移除了 agent 作用域的 ctx.tools.presentAs
//
// 背景：@oh-my-student/plugin-presets 0.1.1（按 0.2.1-rc.4 写）在
//   policy.js attachPolicy() 里无条件调用 ctx.tools.presentAs('native')。
// 宿主 0.2.2-rc.1 的 ToolRuntime 不再提供该方法（restrict/guard 仍在），
// 于是每次创建教学子会话 / 团队通道都抛
//   Error: ctx.tools.presentAs is not a function
// 导致 Notara「独立课堂」完全打不开（用户会话日志 seq 71/76/81/86 四次复现）。
//
// 修法：仅在方法存在时调用（向后兼容 rc.4），新宿主跳过。零行为变化于 restrict/guard。
// 对齐 pnpm store 下全部 @oh-my-student+plugin-prese_<hash> 副本（多为同一 inode 硬链接）。
//
// 用法：
//   node patch-presets-presentas.mjs --check     # 只读体检，任意锚点未 applied 则 exit 1
//   node patch-presets-presentas.mjs --apply     # 打补丁（先备份）
//   node patch-presets-presentas.mjs --restore   # 从备份回滚
// 可用环境变量 DSH_PROFILE_NODE_MODULES 覆盖 profile 的 node_modules 路径。

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROFILE_NM = process.env.DSH_PROFILE_NODE_MODULES
  || resolve(HERE, '..', '.dsh-studier-home', 'profiles', 'web', 'node_modules');
const PNPM = join(PROFILE_NM, '.pnpm');
const BACKUP_ROOT = join(HERE, 'backups', 'presets-presentas');

const sha = (b) => createHash('sha256').update(b).digest('hex');
const count = (s, sub) => s.split(sub).length - 1;

function findCopies() {
  if (!existsSync(PNPM)) return [];
  return readdirSync(PNPM)
    .filter((n) => /^@oh-my-student\+plugin-prese_[0-9a-f]+$/.test(n))
    .sort()
    .map((n) => ({ tag: n.match(/plugin-prese_([0-9a-f]+)/)[1].slice(0, 8), dir: join(PNPM, n, 'node_modules', '@oh-my-student') }));
}

// 唯一锚点：policy.js reconcile() 内 try 块三行 + catch 行
const FROM = [
  "      try {",
  "        disposers.push(ctx.tools.presentAs('native'));",
  "        disposers.push(ctx.tools.restrict({ allow: available }));",
  "        disposers.push(ctx.tools.guard(exec => allowed.has(exec.name) ? undefined : `Tool ${exec.name} is unavailable for ${id}`));",
  "      } catch (error) {",
].join('\n');

const TO = [
  "      try {",
  "        // studier compat: dsh 0.2.2 removed agent-scoped presentAs; call only when available.",
  "        if (typeof ctx.tools.presentAs === 'function') disposers.push(ctx.tools.presentAs('native'));",
  "        disposers.push(ctx.tools.restrict({ allow: available }));",
  "        disposers.push(ctx.tools.guard(exec => allowed.has(exec.name) ? undefined : `Tool ${exec.name} is unavailable for ${id}`));",
  "      } catch (error) {",
].join('\n');

// P2：system-prompt/assemble 监听器假设 result.tools 存在。
// dsh 0.2.2 里 tools 是在 waterfall 返回之后才挂上去的（SystemPrompt.assemble 先建
// {sections,contexts,variables}，跑完 waterfall 才 return {...transformed, tools}）。
// 因此监听器里 result.tools 恒为 undefined，对该 scope 的 Agent 执行 .filter 直接抛
// TypeError: Cannot read properties of undefined (reading 'filter')，子会话第一轮就死。
// 修法：工具裁剪本来就是 restrict/guard 的职责，这里仅在有 tools 时再裁。
const FROM2 = "    return { ...result, tools: result.tools.filter(tool => allowed.has(tool.name)) };";

const TO2 = [
  "    // studier compat: dsh 0.2.2 attaches `tools` only after this waterfall returns.",
  "    if (!Array.isArray(result.tools)) return result;",
  "    return { ...result, tools: result.tools.filter(tool => allowed.has(tool.name)) };",
].join('\n');

// P3：agent/pre-step 监听器假设 decision.messages 存在（某些 next() 结果不含 messages）。
const FROM3 = "    return {...decision,messages:decision.messages.filter(message=>!blind||message.source?.kind!=='working-directory').map(message=>initialChild&&message.source?.kind==='user'&&!message.source.rpcId?{...message,source:{kind:'notara-child-handoff',form:'relay'}}:message)};";

const TO3 = [
  "    // studier compat: some 0.2.2 next() results omit messages; keep the decision intact.",
  "    if (!Array.isArray(decision.messages)) return decision;",
  "    return {...decision,messages:decision.messages.filter(message=>!blind||message.source?.kind!=='working-directory').map(message=>initialChild&&message.source?.kind==='user'&&!message.source.rpcId?{...message,source:{kind:'notara-child-handoff',form:'relay'}}:message)};",
].join('\n');

const PATCHES = {
  'plugin-presets/policy.js': [
    { id: 'P1-presentas-guard', from: FROM, to: TO },
    { id: 'P2-assemble-tools-guard', from: FROM2, to: TO2 },
    { id: 'P3-prestep-messages-guard', from: FROM3, to: TO3 },
  ],
};

function targets() {
  const out = [];
  for (const copy of findCopies()) {
    for (const rel of Object.keys(PATCHES)) {
      const abs = join(copy.dir, rel);
      if (existsSync(abs)) out.push({ ...copy, rel, abs });
    }
  }
  return out;
}

function statusOf(text, patch) {
  const hasFrom = count(text, patch.from) === 1;
  const hasTo = count(text, patch.to) === 1;
  if (hasTo) return 'applied';
  if (hasFrom) return 'pending';
  return 'missing-anchor';
}

function main() {
  const args = process.argv.slice(2);
  const action = args.includes('--restore') ? 'restore' : args.includes('--apply') ? 'apply' : 'check';
  const tgs = targets();
  if (!tgs.length) {
    console.error('[presentas] 未找到 plugin-presets 副本；检查 profile node_modules：' + PROFILE_NM);
    process.exit(2);
  }
  console.log('[presentas] action=' + action + '  profile=' + PROFILE_NM);
  console.log('[presentas] 副本数=' + findCopies().length + '  目标文件数=' + tgs.length);

  let conflicts = 0, changed = 0;
  for (const t of tgs) {
    const label = t.tag + ' ' + t.rel;
    const raw = readFileSync(t.abs);
    let text = raw.toString('utf8');
    const list = PATCHES[t.rel];
    const states = list.map((p) => p.id + '=' + statusOf(text, p));

    if (action === 'check') {
      console.log('  ' + label + ' :: ' + states.join(' '));
      for (const p of list) if (statusOf(text, p) !== 'applied') conflicts++;
      continue;
    }

    if (action === 'apply') {
      const backup = join(BACKUP_ROOT, t.tag, t.rel.replace(/[\\/]/g, '__') + '.orig');
      if (!existsSync(backup)) { mkdirSync(dirname(backup), { recursive: true }); writeFileSync(backup, raw); }
      for (const p of list) {
        const st = statusOf(text, p);
        if (st === 'pending') { text = text.replace(p.from, p.to); changed++; }
        else if (st === 'missing-anchor') { console.error('  [冲突] ' + label + ' :: ' + p.id + ' = ' + st); conflicts++; }
      }
      if (text !== raw.toString('utf8')) { writeFileSync(t.abs, text, 'utf8'); console.log('  [已打] ' + label + ' sha=' + sha(Buffer.from(text)).slice(0, 12)); }
      else console.log('  [跳过] ' + label + '（无改动）');
    }

    if (action === 'restore') {
      const backup = join(BACKUP_ROOT, t.tag, t.rel.replace(/[\\/]/g, '__') + '.orig');
      if (!existsSync(backup)) { console.error('  [无备份] ' + label); conflicts++; continue; }
      const currentText = raw.toString('utf8');
      const allApplied = list.every((p) => statusOf(currentText, p) === 'applied');
      if (!allApplied) { console.error('  [校验失败] ' + label + ' 当前不是完整已打补丁状态，拒绝覆盖'); conflicts++; continue; }
      writeFileSync(t.abs, readFileSync(backup));
      changed++;
      console.log('  [已回滚] ' + label);
    }
  }

  console.log('[presentas] 完成：改动 ' + changed + ' 项，冲突 ' + conflicts + ' 项');
  if (conflicts) process.exit(1);
}

main();
