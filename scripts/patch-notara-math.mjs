#!/usr/bin/env node
/**
 * E:\studier\dsh-instance\patch-notara-math.mjs
 * ---------------------------------------------------------------------------
 * 修 Notara 双宿主 bundle 的 LaTeX 空白 bug（只改 math-adapter.mjs）。
 *
 * 根因：0.2.2-rc.1 的 webTarget.patch 把原始
 *   mdastExtensions:[F8(),wb(),Gy()]   （wb = mathFromMarkdown）
 * 误写成
 *   mdastExtensions:[F8(),Gy()]
 * micromark 仍能切出 math token，但 mdast 没有转换器 → 节点被静默丢弃
 * → React markdown 渲染器无节点可画 → $...$ 整段显示空白。
 * Node 侧 math-adapter.mjs:49 一直保留 mathFromMarkdown()，故只有浏览器端坏。
 *
 * 本脚本把两处 [F8(),Gy()] 改回 [F8(),wb(),Gy()]，幂等、备份、可回滚。
 * 改完后必须跑 repair.mjs（不带 --check）让 host-adapter --restore → apply
 * 重新生成内容寻址的 index-notara-math-<sha256>.js，并重启实例刷新页面。
 *
 * 用法：
 *   node patch-notara-math.mjs --check     # 只读体检，退出码 0 = 全部已修
 *   node patch-notara-math.mjs --apply     # 实际修复（幂等）
 *   node patch-notara-math.mjs --restore   # 从备份回滚
 *
 * 环境变量 DSH_PROFILE_NODE_MODULES 可覆盖 .pnpm 所在 node_modules。
 * 依赖：仅 node: 内置模块（Node 22+，ESM）。
 * ---------------------------------------------------------------------------
 */

import {
  existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync,
  statSync, copyFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(import.meta.url);
const INSTANCE_DIR = path.dirname(SCRIPT);          // …\dsh-instance
const STUDIER_ROOT = path.dirname(INSTANCE_DIR);    // E:\studier
const PROFILE_NM = process.env.DSH_PROFILE_NODE_MODULES
  ? path.resolve(process.env.DSH_PROFILE_NODE_MODULES)
  : path.join(STUDIER_ROOT, '.dsh-studier-home', 'profiles', 'web', 'node_modules');
const PNPM_DIR = path.join(PROFILE_NM, '.pnpm');
const BACKUP_DIR = path.join(INSTANCE_DIR, 'backups', 'notara-math');

const BAD = 'mdastExtensions:[F8(),Gy()]';
const GOOD = 'mdastExtensions:[F8(),wb(),Gy()]';
// 双宿主版（11208B）里：BAD 应恰好 2 处、GOOD 恰好 1 处（原始锚点）。
// 改完后：BAD 0 处、GOOD 3 处。
const DUAL_HOST_SIZE = 11208;

function count(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

function findCopies() {
  const out = [];
  const add = (p, label) => { if (existsSync(p)) out.push({ path: p, label }); };

  // 真源 / 分发暂存 / 用户解包的 PR 参照副本
  add(path.join(INSTANCE_DIR, 'vendor', 'notara-bundle', 'math-adapter.mjs'), 'vendor');
  add(path.join(STUDIER_ROOT, 'pack', 'studier-dsh-插件包', 'notara-bundle', 'math-adapter.mjs'), 'pack');
  add(path.join(STUDIER_ROOT, 'pr', 'pr', 'plugins', 'bundle', 'math-adapter.mjs'), 'pr/plugins');
  add(path.join(STUDIER_ROOT, 'pr', 'pr', 'notara-dsh-bundle-0.1.2-dual-host', 'plugins', 'bundle', 'math-adapter.mjs'), 'pr/dual-host');
  // 独立开源仓库里的副本（若存在）
  add(path.join(STUDIER_ROOT, 'pack', 'dsh-studier-repo', 'scripts', 'notara-bundle', 'math-adapter.mjs'), 'repo');

  // 运行时的 .pnpm 副本（host-adapter 实际 import 的就是这些）
  if (existsSync(PNPM_DIR)) {
    for (const d of readdirSync(PNPM_DIR)) {
      if (!d.startsWith('@oh-my-student+dsh-bundle@')) continue;
      add(path.join(PNPM_DIR, d, 'node_modules', '@oh-my-student', 'dsh-bundle', 'math-adapter.mjs'), d);
    }
  }
  return out;
}

function statusOf(p) {
  const s = readFileSync(p, 'utf8');
  const bad = count(s, BAD), good = count(s, GOOD);
  if (bad === 0 && good === 3) return { state: 'applied', bad, good, text: s };
  if (bad === 2 && good === 1) return { state: 'pending', bad, good, text: s };
  if (s.length < DUAL_HOST_SIZE - 2000 || (bad === 0 && good === 0)) {
    return { state: 'not-dual-host', bad, good, text: s };   // rc.4 旧版/其它版本，不碰
  }
  return { state: 'ambiguous', bad, good, text: s };
}

function backupPathFor(p) {
  const rel = path.relative(STUDIER_ROOT, p).replace(/[\\/:]/g, '__');
  return path.join(BACKUP_DIR, rel + '.orig');
}

function ensureBackup(p) {
  const b = backupPathFor(p);
  if (!existsSync(b)) {
    mkdirSync(path.dirname(b), { recursive: true });
    copyFileSync(p, b);
  }
  return b;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const restore = args.includes('--restore');
  const apply = args.includes('--apply') || (!check && !restore);
  const copies = findCopies();

  if (copies.length === 0) {
    console.log(`没有找到任何 math-adapter.mjs（PNPM_DIR=${PNPM_DIR}）`);
    process.exitCode = 1;
    return;
  }

  let pending = 0, applied = 0, skipped = 0, failed = 0, restored = 0;

  for (const { path: p, label } of copies) {
    // 硬链接副本可能已被前一次写入改动：每次都重新读
    const st = statusOf(p);
    if (st.state === 'not-dual-host') {
      console.log(`  · 跳过 ${label}（非双宿主 rc.1 版，size=${st.text.length}）`);
      skipped++;
      continue;
    }
    if (st.state === 'ambiguous') {
      console.log(`  ! ${label} 锚点异常：BAD=${st.bad} GOOD=${st.good}（不改动）`);
      failed++;
      continue;
    }

    if (restore) {
      if (st.state === 'pending') {
        const b = backupPathFor(p);
        if (!existsSync(b)) { console.log(`  ! ${label} 缺备份：${b}`); failed++; continue; }
        writeFileSync(p, readFileSync(b, 'utf8'));
        console.log(`  ↩ ${label} 已回滚`);
        restored++;
      } else {
        console.log(`  · ${label} 无需回滚（${st.state}）`);
        skipped++;
      }
      continue;
    }

    if (check) {
      if (st.state === 'applied') { console.log(`  ✓ ${label} 已修（GOOD=${st.good}）`); applied++; }
      else { console.log(`  ✗ ${label} 待修（BAD=${st.bad} GOOD=${st.good}）`); pending++; }
      continue;
    }

    if (apply) {
      if (st.state === 'applied') { console.log(`  · ${label} 已修，跳过`); applied++; continue; }
      ensureBackup(p);
      const fixed = st.text.split(BAD).join(GOOD);
      if (count(fixed, BAD) !== 0 || count(fixed, GOOD) !== 3) {
        console.log(`  ! ${label} 替换后校验失败，未写入`); failed++; continue;
      }
      writeFileSync(p, fixed);   // 原地写：保持 NTFS 硬链接（勿用 temp+rename）
      console.log(`  ✔ ${label} 已修（2 处 [F8(),Gy()] → [F8(),wb(),Gy()]）`);
      pending++;
    }
  }

  console.log('');
  if (check) {
    console.log(`体检：${applied} 已修 / ${pending} 待修 / ${skipped} 跳过 / ${failed} 异常`);
    process.exitCode = (pending > 0 || failed > 0) ? 1 : 0;
  } else if (restore) {
    console.log(`回滚：${restored} 项已回滚 / ${skipped} 项无需回滚 / ${failed} 项失败`);
    process.exitCode = failed > 0 ? 1 : 0;
  } else {
    console.log(`修复：${pending} 项改动 / ${applied} 项已就绪 / ${skipped} 项跳过 / ${failed} 项失败`);
    if (pending > 0) console.log('提示：接着跑 node repair.mjs（不带 --check）重新生成 web 数学资产，然后重启实例并硬刷新页面。');
    process.exitCode = failed > 0 ? 1 : 0;
  }
}

main();
