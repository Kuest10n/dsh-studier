#!/usr/bin/env node
// 单元验证：修后的 Notara presets/policy.js 在 dsh 0.2.2-rc.1 下不再抛错。
// 三组对比：
//   1) 补丁前代码 + 0.2.2 运行时（ctx.tools 无 presentAs）→ 必须重现
//      `ctx.tools.presentAs is not a function`。
//   2) 补丁后代码 + 0.2.2 运行时 → 不抛错、跳过 presentAs、restrict/guard 仍生效。
//   3) 补丁后代码 + rc.4 运行时（有 presentAs）→ 仍调用 presentAs('native')。
// 另加 P2/P3 回归：
//   4) system-prompt/assemble 监听器在 result 无 tools（0.2.2 的 assembly 形状）时不抛错；
//      有 tools 数组时仍按 allowed 过滤。
//   5) agent/pre-step 监听器在 decision 无 messages 时原样返回，有 messages 时照旧过滤。
//
// 做法：把 policy.js 的 import 替换成内存桩，写进临时 .mjs 再 import，
// 这样测到的是真实补丁后的函数体，而不是重写一份逻辑。
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const NM = 'E:\\studier\\.dsh-studier-home\\profiles\\web\\node_modules';
const PATCHED = join(NM, '.pnpm', '@oh-my-student+plugin-prese_56c7513aec07c68770a5e471777b1fa5', 'node_modules', '@oh-my-student', 'plugin-presets', 'policy.js');
const ORIG = 'E:\\studier\\dsh-instance\\backups\\presets-presentas\\56c7513a\\plugin-presets__policy.js.orig';

const STUB = [
  "const ROLES = [{ id: 'notara-teacher', kind: 'teacher' }];",
  'const roleById = () => ROLES[0];',
  "const scopeParentOf = () => 'scope';",
  "const scopeOf = () => 'gen';",
  "const scopeChainOf = () => ['gen'];",
].join('\n');

function materialize(source, file) {
  let t = readFileSync(source, 'utf8');
  t = t.replace(/import \{ ROLES, roleById \} from '\.\/catalog\.js';/, STUB);
  t = t.replace(/import \{ scopeParentOf, scopeOf, scopeChainOf \} from '@deepseek-ai\/dsh-scope';/, '');
  if (/^import /m.test(t)) throw new Error('unreplaced import remains:\n' + t.split('\n').filter((l) => l.startsWith('import ')).join('\n'));
  writeFileSync(file, t, 'utf8');
}

function makeCtx(withPresentAs, log) {
  const agent = { ctx: null, session: { snapshotEvents: () => [] } };
  const listeners = new Map();
  const tools = {
    get: () => ({ name: 'allowed-tool' }), // 让 available 非空
    restrict: () => { log.push('restrict'); return () => {}; },
    guard: () => { log.push('guard'); return () => {}; },
  };
  if (withPresentAs) tools.presentAs = (m) => { log.push('presentAs:' + m); return () => {}; };
  const ctx = {
    tools,
    get: (k) => (k === 'agentPresets' ? { composedPreset: () => 'notara-teacher' } : undefined),
    agents: { list: () => [agent], roots: () => [agent] },
    on: (event, fn) => { listeners.set(event, fn); },
    effect: () => {},
  };
  agent.ctx = ctx;
  return { ctx, agent, listeners };
}

async function load(label, source) {
  const dir = mkdtempSync(join(tmpdir(), 'presas-test-'));
  const file = join(dir, 'policy.mjs');
  materialize(source, file);
  const mod = await import(pathToFileURL(file).href + '?v=' + createHash('sha1').update(label + Date.now()).digest('hex').slice(0, 6));
  return { mod, dir };
}

async function run(label, source, withPresentAs) {
  const { mod, dir } = await load(label, source);
  const log = [];
  const { ctx, agent, listeners } = makeCtx(withPresentAs, log);
  let thrown = null;
  try { mod.apply(ctx, { preset: 'notara-teacher' }); } catch (e) { thrown = e; }
  rmSync(dir, { recursive: true, force: true });
  return { label, thrown, log, ctx, agent, listeners };
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  PASS  ' + name); pass++; }
  else { console.log('  FAIL  ' + name + (detail ? ' :: ' + detail : '')); fail++; }
}

const control = await run('orig/no-presentAs', ORIG, false);
const p22 = await run('patched/no-presentAs', PATCHED, false);
const prc4 = await run('patched/with-presentAs', PATCHED, true);

console.log('[test-presentas] 1) presentAs 兼容');
check('对照组复现 presentAs is not a function',
  control.thrown && /presentAs is not a function/.test(control.thrown.message),
  control.thrown ? control.thrown.message : '(未抛错)');
check('0.2.2 运行时不抛错', !p22.thrown, p22.thrown && p22.thrown.message);
check('0.2.2 跳过 presentAs', !p22.log.some((x) => x.startsWith('presentAs')));
check('0.2.2 仍执行 restrict', p22.log.includes('restrict'));
check('0.2.2 仍执行 guard', p22.log.includes('guard'));
check('rc.4 不抛错', !prc4.thrown, prc4.thrown && prc4.thrown.message);
check('rc.4 仍调用 presentAs(native)', prc4.log.includes('presentAs:native'));
check('rc.4 仍执行 restrict/guard', prc4.log.includes('restrict') && prc4.log.includes('guard'));

console.log('[test-presentas] 2) system-prompt/assemble 监听器（0.2.2 里 tools 在 waterfall 之后才挂载）');
const assemble = p22.listeners.get('system-prompt/assemble');
check('已注册 assemble 监听器', typeof assemble === 'function');
if (typeof assemble === 'function') {
  const baseAssembly = { sections: [], contexts: [], variables: {} }; // 真实 0.2.2 形状：没有 tools
  let err = null, out = null;
  try {
    out = await assemble(baseAssembly, { scope: p22.agent }, async () => baseAssembly);
  } catch (e) { err = e; }
  check('无 tools 时不抛 TypeError', !err, err && err.message);
  check('无 tools 时原样返回 assembly', out === baseAssembly || (out && !('tools' in out)));
  const withTools = { sections: [], contexts: [], variables: {}, tools: [{ name: 'read' }, { name: 'nope-not-allowed' }] };
  let err2 = null, out2 = null;
  try {
    out2 = await assemble(withTools, { scope: p22.agent }, async () => withTools);
  } catch (e) { err2 = e; }
  check('有 tools 时不抛错', !err2, err2 && err2.message);
  check('有 tools 时仍做过滤（保留 role 允许的工具）', out2 && Array.isArray(out2.tools) && out2.tools.length === 1 && out2.tools[0].name === 'read',
    out2 && JSON.stringify(out2.tools));
}

console.log('[test-presentas] 3) agent/pre-step 监听器（部分 next() 结果不含 messages）');
const preStep = p22.listeners.get('agent/pre-step');
check('已注册 pre-step 监听器', typeof preStep === 'function');
if (typeof preStep === 'function') {
  const noMsg = { kind: 'enter' };
  let err = null, out = null;
  try { out = await preStep({}, async () => noMsg); } catch (e) { err = e; }
  check('无 messages 时不抛错', !err, err && err.message);
  check('无 messages 时原样返回 decision', out === noMsg);
  const withMsg = { kind: 'enter', messages: [{ source: { kind: 'user' } }] };
  let err2 = null, out2 = null;
  try { out2 = await preStep({}, async () => withMsg); } catch (e) { err2 = e; }
  check('有 messages 时不抛错', !err2, err2 && err2.message);
  check('有 messages 时仍返回 messages 数组', out2 && Array.isArray(out2.messages) && out2.messages.length === 1);
  const other = { kind: 'stop' };
  const out3 = await preStep({}, async () => other);
  check('kind!=enter 时原样返回', out3 === other);
}

console.log('[test-presentas] ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
