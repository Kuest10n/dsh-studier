#!/usr/bin/env node
// Notara 资料库文件删除补丁（幂等 / --check | --apply | --restore）
//
// 背景：dsh-bundle 0.1.1（Node）的 Notara 只实现了资料库「新建/保存」，前端与后端
// 均无「删除文件」链路。本补丁补齐：
//   后端 plugin-vault-sqlite：VAULT_REMOTE_METHODS 增加 'delete' + store.delete(file)
//     —— 用 checkedTarget(safeRelativePath) 做真实路径白名单，拒绝越权/符号链接/缓存文件。
//   前端 plugin-vault-views/dist/client.js：VAULT_REMOTE_METHODS 白名单 + 删除函数
//     —— 总览「⋯」菜单加「删除所选资料」项、footer 加「删除所选」按钮，
//        均走 window.confirm 二次确认，再逐个 callVault('delete') 并刷新。
//
// 对齐 pnpm store 下全部 5 份 @oh-my-student/plugin-vault_<hash> 副本（profile 软链可能指向任意一份）。
// 不联网、不 fork 上游；仅做精确字符串替换，替换前后校验出现次数，冲突即失败退出。
//
// 用法：
//   node patch-vault-delete.mjs --check     # 只读体检：列出每份副本每个锚点状态
//   node patch-vault-delete.mjs --apply     # 打补丁（先备份原文件）
//   node patch-vault-delete.mjs --restore   # 反向回滚（按备份内容逐字节恢复）
// 可用环境变量 DSH_PROFILE_NODE_MODULES 覆盖 profile 的 node_modules 路径。

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROFILE_NM = process.env.DSH_PROFILE_NODE_MODULES
  || resolve(HERE, '..', '.dsh-studier-home', 'profiles', 'web', 'node_modules');
const PNPM = join(PROFILE_NM, '.pnpm');
const BACKUP_ROOT = join(HERE, 'backups', 'vault-delete');

const esc = (s) => [...s].map((c) => '\\u' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')).join('');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const count = (s, sub) => s.split(sub).length - 1;

function findCopies() {
  if (!existsSync(PNPM)) return [];
  return readdirSync(PNPM)
    .filter((n) => /^@oh-my-student\+plugin-vault_[0-9a-f]+$/.test(n))
    .sort()
    .map((n) => ({ tag: n.match(/plugin-vault_([0-9a-f]+)/)[1].slice(0, 8), dir: join(PNPM, n, 'node_modules', '@oh-my-student') }));
}

// 删除函数（中文以 \uXXXX 注入，保持 dist 文件风格一致）
const deleteFn = String.raw`  const deleteSelected = async () => {
    const chosen = [...selected2.values()];
    if (!chosen.length) { setMessage("` + esc('请先勾选要删除的资料') + `"); return; }
    if (!window.confirm("` + esc('确定删除选中的 ') + `" + chosen.length + "` + esc(' 份资料？此操作不可撤销。') + `")) return;
    setMessage("");
    let done = 0; const failures = [];
    for (const doc2 of chosen) {
      try {
        // 直接走 RPC 端点：RPC proxy 在 boot 时按 descriptor 生成，可能没有 delete 方法。
        const envelope = { type: "client-request", rpcId: "del-" + Math.random().toString(36).slice(2), method: "notaraVault/delete", payload: { args: { input: { path: doc2.path, expectedRevision: doc2.revision, workspaceId } } } };
        const resp = await fetch("/api/notaraVault/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(envelope) });
        const reply = await resp.json();
        if (reply && reply.ok === false) throw new Error((reply.error && (reply.error.message || reply.error.code)) || "delete failed");
        done++;
      } catch (error4) { failures.push(doc2.path + ": " + (error4 && error4.message ? error4.message : "unknown")); }
    }
    setSelected(/* @__PURE__ */ new Map());
    setMessage("` + esc('已删除 ') + `" + done + "` + esc(' 份') + `" + (failures.length ? "` + esc('，') + `" + failures.length + "` + esc(' 份失败：') + `" + failures.join("; ") : ""));
    changed();
    reload((value2) => value2 + 1);
  };
`;

// 每个补丁：{ id, from, to }；from/to 均为唯一锚点
function buildPatches() {
  return {
    'plugin-vault-sqlite/remote.js': [
      {
        id: 'BE1-remote-method',
        from: "  'drawingCommit','drawingActivity','drawingPreview', 'changes',\n]);",
        to: "  'drawingCommit','drawingActivity','drawingPreview', 'changes', 'delete',\n]);",
      },
    ],
    'plugin-vault-sqlite/vault-indexer.js': [
      {
        id: 'BE2-store-delete',
        from: "  const store = { query, graph, homeRecommendations, read, save, toggleTask, calendarSources,...createDrawingSession({read,save,now}),",
        to: [
          '  function removeFile(input) {',
          "    const { path, expectedRevision } = inputObject(input);",
          '    const target = checkedTarget(path, false, safeRelativePath);',
          "    if (!target.stat) fail('vault_not_found');",
          '    const revision = hash(bytes(path, 64 * 1024 * 1024, target).data);',
          "    if (expectedRevision != null && expectedRevision !== revision) fail('vault_revision_conflict');",
          '    unlinkSync(target.full);',
          '    transaction(() => remove(path));',
          '    return { path, deleted: true };',
          '  }',
          '  const store = { query, graph, homeRecommendations, read, save, toggleTask, calendarSources, delete: removeFile, ...createDrawingSession({read,save,now}),',
        ].join('\n'),
      },
    ],
    'plugin-vault-views/dist/client.js': [
      {
        id: 'FE1-remote-methods',
        from: '  "drawingPreview",\n  "changes"\n]);',
        to: '  "drawingPreview",\n  "changes",\n  "delete"\n]);',
      },
      {
        id: 'FE2-delete-function',
        from: '      setBringing(false);\n    }\n  };\n  const onTag = (tag) => {',
        to: '      setBringing(false);\n    }\n  };\n' + deleteFn + '  const onTag = (tag) => {',
      },
      {
        id: 'FE3-menu-branch',
        from: '          if (id41 === "refresh") reload((value2) => value2 + 1);\n          else setEditor(id41);',
        to: '          if (id41 === "refresh") reload((value2) => value2 + 1);\n          else if (id41 === "delete") void deleteSelected();\n          else setEditor(id41);',
      },
      {
        id: 'FE4-menu-item',
        from: String.raw`{ id: "settings", label: "\u89C6\u56FE\u8BBE\u7F6E\u2026" }]`,
        to: String.raw`{ id: "settings", label: "\u89C6\u56FE\u8BBE\u7F6E\u2026" }, { id: "delete", label: "` + esc('删除所选资料') + String.raw`" }]`,
      },
      {
        id: 'FE5-footer-button',
        from: String.raw`          selected2.size > 0 && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { onClick: () => setSelected(/* @__PURE__ */ new Map()), children: "\u53D6\u6D88\u9009\u62E9" })`,
        to: String.raw`          selected2.size > 0 && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { className: "nv-base-secondary", onClick: () => void deleteSelected(), children: "` + esc('删除所选') + String.raw`" }),
          selected2.size > 0 && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { onClick: () => setSelected(/* @__PURE__ */ new Map()), children: "\u53D6\u6D88\u9009\u62E9" })`,
      },
    ],
  };
}

function targets() {
  const out = [];
  for (const copy of findCopies()) {
    for (const rel of Object.keys(buildPatches())) {
      const abs = join(copy.dir, rel);
      if (existsSync(abs)) out.push({ ...copy, rel, abs });
    }
  }
  return out;
}

function statusOf(text, patch) {
  const hasFrom = count(text, patch.from) === 1;
  const hasTo = count(text, patch.to) === 1;
  // to 可能包含 from 作为子串（如 FE5 保留了原「取消选择」按钮行），
  // 因此优先判断 to：目标文本已出现即为已打补丁。
  if (hasTo) return 'applied';
  if (hasFrom) return 'pending';
  return 'missing-anchor';
}

function main() {
  const args = process.argv.slice(2);
  const action = args.includes('--restore') ? 'restore' : args.includes('--reapply') ? 'reapply' : args.includes('--apply') ? 'apply' : 'check';
  const patches = buildPatches();
  const tgs = targets();
  if (!tgs.length) {
    console.error('未找到 plugin-vault 副本；检查 profile node_modules：' + PROFILE_NM);
    process.exit(2);
  }
  console.log('[vault-delete] action=' + action + '  profile=' + PROFILE_NM);
  console.log('[vault-delete] 副本数=' + findCopies().length + '  目标文件数=' + tgs.length);

  let conflicts = 0, changed = 0;
  for (const t of tgs) {
    const label = t.tag + ' ' + t.rel;
    const raw = readFileSync(t.abs);
    let text = raw.toString('utf8');
    const list = patches[t.rel];
    const states = list.map((p) => p.id + '=' + statusOf(text, p));
    if (action === 'check') {
      console.log('  ' + label + ' :: ' + states.join(' '));
      // --check 也要给明确退出码：任何一个锚点没打上就算「未就绪」，供 repair.mjs 判定。
      for (const p of list) if (statusOf(text, p) !== 'applied') conflicts++;
      continue;
    }

    if (action === 'apply') {
      const backup = join(BACKUP_ROOT, t.tag, t.rel.replace(/[\\/]/g, '__') + '.orig');
      if (!existsSync(backup)) { mkdirSync(dirname(backup), { recursive: true }); writeFileSync(backup, raw); }
      for (const p of list) {
        const st = statusOf(text, p);
        if (st === 'pending') { text = text.replace(p.from, p.to); changed++; }
        else if (st === 'ambiguous' || st === 'missing-anchor') { console.error('  [冲突] ' + label + ' :: ' + p.id + ' = ' + st); conflicts++; }
      }
      if (text !== raw.toString('utf8')) { writeFileSync(t.abs, text, 'utf8'); console.log('  [已打] ' + label + ' sha=' + sha(Buffer.from(text)).slice(0, 12)); }
      else console.log('  [跳过] ' + label + '（无改动）');
    }

    if (action === 'reapply') {
      // 从原始备份用「当前模板」重打：用于补丁模板升级后刷新已落地文件。
      const backup = join(BACKUP_ROOT, t.tag, t.rel.replace(/[\\/]/g, '__') + '.orig');
      if (!existsSync(backup)) { console.error('  [无备份] ' + label + '（无法重打，请先 --apply 生成备份）'); conflicts++; continue; }
      const orig = readFileSync(backup).toString('utf8');
      let out = orig;
      for (const p of list) {
        const st = statusOf(out, p);
        if (st === 'pending') { out = out.replace(p.from, p.to); changed++; }
        else if (st !== 'applied') { console.error('  [冲突] ' + label + ' :: ' + p.id + ' = ' + st); conflicts++; }
      }
      if (out !== orig) { writeFileSync(t.abs, out, 'utf8'); console.log('  [重打] ' + label + ' sha=' + sha(Buffer.from(out)).slice(0, 12)); }
      else console.log('  [跳过] ' + label + '（备份已是目标状态）');
    }

    if (action === 'restore') {
      const backup = join(BACKUP_ROOT, t.tag, t.rel.replace(/[\\/]/g, '__') + '.orig');
      if (!existsSync(backup)) { console.error('  [无备份] ' + label); conflicts++; continue; }
      const orig = readFileSync(backup);
      // 只允许回滚「当前确实处于已打补丁状态」的文件：防止覆盖掉外部改动。
      const currentText = raw.toString('utf8');
      const allApplied = list.every((p) => statusOf(currentText, p) === 'applied');
      if (!allApplied) { console.error('  [校验失败] ' + label + ' 当前内容不是完整的已打补丁状态，拒绝覆盖'); conflicts++; continue; }
      writeFileSync(t.abs, orig);
      changed++;
      console.log('  [已回滚] ' + label);
    }
  }

  console.log('[vault-delete] 完成：改动 ' + changed + ' 项，冲突 ' + conflicts + ' 项');
  if (conflicts) process.exit(1);
}

main();
