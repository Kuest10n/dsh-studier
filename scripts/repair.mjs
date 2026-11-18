#!/usr/bin/env node
/**
 * E:\studier\dsh-instance\repair.mjs
 * ---------------------------------------------------------------------------
 * studier 学习工作台（独立瘦身 DSH 实例）的「一键修复 / 重建」脚本。
 *
 * 用法：
 *   node E:\studier\dsh-instance\repair.mjs            # 实际修复（幂等）
 *   node E:\studier\dsh-instance\repair.mjs --check    # 只检查、绝不改动
 *
 * 五步：
 *   [1/5] 补 0.1.1 缺件：user-message-text.js / markdown-math.js
 *   [2/5] 重建 host-targets/@deepseek-ai 下 6 个 junction
 *   [3/5] 跑 Notara host-adapter：--restore → apply → --check
 *   [4/5] 校验 $DSH_HOME\skills 下 6 个 skill junction + SKILL.md frontmatter
 *   [5/5] 资料库文件删除补丁 patch-vault-delete.mjs（--check / --apply）
 *
 * 依赖：仅 node: 内置模块（Node 22+，ESM）。不装包、不改 vault、不重启服务。
 * 幂等：重复执行不产生新副作用；已就绪的项一律打印「·」并说明跳过原因。
 * ---------------------------------------------------------------------------
 */

import {
  existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync,
  readdirSync, statSync, lstatSync, unlinkSync, rmSync, symlinkSync,
  readlinkSync, realpathSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// 路径常量
// ---------------------------------------------------------------------------

const SCRIPT_PATH = fileURLToPath(import.meta.url);        // …\dsh-instance\repair.mjs
const INSTANCE_DIR = path.dirname(SCRIPT_PATH);            // …\dsh-instance
const STUDIER_ROOT = path.dirname(INSTANCE_DIR);           // E:\studier

// 运行时根目录：固定为兄弟目录 .dsh-studier-home。
//
// 【坑 0】不要默认读 process.env.DSH_HOME。
//   这个名字是 DSH 自己的开关：你此刻所在的任意 DSH 会话（包括 harness 自带的那个）
//   都可能已经把 DSH_HOME 设成了 C:\Users\<你>\.dsh。照读就会去修别人的 home，
//   而那个 home 里根本没有 studier profile —— 表面上「跑完了」，实际什么都没修。
//   ⇒ 默认写死本实例的 home；要换机器/换路径时用 --dsh-home 或 STUDIER_DSH_HOME 显式指定。
const DSH_HOME_ARG = (() => {
  const i = process.argv.indexOf('--dsh-home');
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith('--dsh-home='));
  if (eq) return eq.slice('--dsh-home='.length);
  return process.env.STUDIER_DSH_HOME || null;
})();

const DSH_HOME = DSH_HOME_ARG
  ? path.resolve(DSH_HOME_ARG)
  : path.join(STUDIER_ROOT, '.dsh-studier-home');

const PROFILE_DIR = path.join(DSH_HOME, 'profiles', 'web');
const PROFILE_NM = path.join(PROFILE_DIR, 'node_modules');
const PNPM_DIR = path.join(PROFILE_NM, '.pnpm');           // pnpm 的 virtual store
const VENDOR_DIR = path.join(INSTANCE_DIR, 'vendor');
const HOST_TARGETS = path.join(INSTANCE_DIR, 'host-targets', '@deepseek-ai');
const SKILLS_SRC = path.join(INSTANCE_DIR, 'skills');      // skill 真源
const SKILLS_DST = path.join(DSH_HOME, 'skills');          // 运行时 junction 农场

// 宿主版本：所有 @deepseek-ai/dsh-* 包都必须是这一版，绝不能混装。
const DSH_VERSION = '0.2.2-rc.1';

// 需要挂进 host-targets 的 6 个宿主包（顺序即日志顺序）。
const HOST_PACKAGES = [
  'dsh-client-ui-chat',
  'dsh-client-ui-conversation',
  'dsh-client-ui-primitives',
  'dsh-client-ui-skill',
  'dsh-client-ui-input-trigger',
  'dsh-web-frontend',
];

const SKILL_NAMES = [
  'studier-weekend-intake',
  'studier-kp-classify',
  'studier-math-tutor',
  'studier-card-judge',
  'studier-weekly-plan',
  'studier-peer-test',
];

const GRAPH_PKG = '@oh-my-student/plugin-graph-and-blocks';
const BUNDLE_PKG = '@oh-my-student/dsh-bundle';

// ---------------------------------------------------------------------------
// 0.1.1 缺件的两份源码手术清单
// 目标相对于 <plugin-graph-and-blocks>/src/，源是 vendor/ 里的 0.1.2 原件。
// ---------------------------------------------------------------------------
const SOURCE_PATCHES = [
  {
    // adapter 里 require.resolve('@oh-my-student/plugin-graph-and-blocks/chat-visibility')
    // 之后会读同目录的 ./user-message-text.js；0.1.1 没有这个文件 → 直接 ENOENT 崩。
    target: path.join('src', 'user-message-text.js'),
    vendor: path.join(VENDOR_DIR, 'user-message-text.repo.js'),
    why: 'adapter 取 chat-visibility 的同目录 helper',
  },
  {
    // 0.1.1 的 markdown-math.js 缺 notaraStreamingMathParser / notaraMathFreezeBoundary
    // → 助手消息渲染时 ReferenceError。
    target: path.join('src', 'domain', 'markdown-math.js'),
    vendor: path.join(VENDOR_DIR, 'markdown-math.repo.js'),
    why: '缺 notaraStreamingMathParser / notaraMathFreezeBoundary',
  },
];

const CHECK_ONLY = process.argv.includes('--check');
const argvUnknown = (() => {
  const rest = process.argv.slice(2);
  const unknown = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--check' || a === '--help' || a === '-h') continue;
    if (a === '--dsh-home') { i++; continue; }            // 吃掉它的值
    if (a.startsWith('--dsh-home=')) continue;
    unknown.push(a);
  }
  return unknown;
})();

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

const out = (s = '') => process.stdout.write(s + '\n');

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

const shortHash = (h) => h.slice(0, 12) + '…';

/**
 * 读 JSON 文件，顺手剥掉 UTF-8 BOM。
 *
 * 【坑 0.5】package.json 看起来是纯文本，但 Windows 上「谁写的」很重要：
 *   PowerShell 5.1 的 `-Encoding utf8` 会写 BOM（EF BB BF），
 *   而 JSON.parse 见到 BOM 直接抛 SyntaxError。
 *   本脚本靠 package.json 的 name/version 定位 store 包，
 *   一旦解析失败就会被当成「半损坏目录」默默跳过，
 *   症状是「pnpm store 里找不到 @oh-my-student/plugin-graph-and-blocks」这种误导性报错。
 *   ⇒ 统一走这个函数，BOM 不再能让定位失明。
 */
function readJsonFile(file) {
  return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

/** 把 Windows junction 的 readlink 结果规范化，便于比较。 */
function normalizeLinkTarget(p) {
  let s = String(p);
  if (s.startsWith('\\\\?\\')) s = s.slice(4);       // 去掉 NT 命名空间前缀
  s = s.replace(/[\\/]+$/, '');                       // 去掉尾部分隔符
  return s.toLowerCase().replace(/\//g, '\\');
}

/** 同一目录判断（Windows 不区分大小写）。 */
function sameDir(a, b) {
  if (normalizeLinkTarget(a) === normalizeLinkTarget(b)) return true;
  // 【坑 0.6】纯字符串比较会漏判两种 Windows 常见「同一个目录」：
  //   ① 8.3 短名（C:\Users\ADMINI~1\… 与 C:\Users\Administrator\… 是同一条路径）
  //   ② junction 记录的目标可能带 \\?\ 前缀或不同大小写
  //   漏判的后果不是崩，而是每次都把「其实已经正确」的 junction 判成错，
  //   于是一次次 unlink + 重建 —— 幂等性看起来还在，实际每次都在动盘。
  //   ⇒ 字符串不通时再用 realpath 确认一次物理身份（取不到就认定不同）。
  try {
    return normalizeLinkTarget(realpathSync(a)) === normalizeLinkTarget(realpathSync(b));
  } catch {
    return false;                    // 路径不存在：只可能是「需要创建」
  }
}

let _pnpmDirs = null;
/** 列出 .pnpm 下的所有虚拟 store 目录（缓存）。 */
function pnpmDirs() {
  if (_pnpmDirs) return _pnpmDirs;
  if (!existsSync(PNPM_DIR)) {
    throw new Error(`pnpm store 不存在：${PNPM_DIR}（profile 未安装？）`);
  }
  _pnpmDirs = readdirSync(PNPM_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() || d.isSymbolicLink())
    .map((d) => path.join(PNPM_DIR, d.name))
    .sort();
  return _pnpmDirs;
}

/**
 * 在 pnpm store 里定位某个 @scope/name@version 包的真实目录。
 *
 * 【坑 1】绝不能用版本号拼目录名。
 *   pnpm 11 的虚拟 store 目录名会把「包名 + 版本」截断成 56 字符再加内容哈希，
 *   例如 @deepseek-ai+dsh-client-ui-input-trigger@0.2.2-rc.1 会变成
 *     @deepseek-ai+dsh-client-ui-_9b0a91ef75feef05da95f55b5865d4cc
 *   版本号 0.2.2-rc.1 在目录名里根本不存在（被截断成 "@0._"）。
 *   ⇒ 唯一可靠的办法：进目录读 node_modules/<name>/package.json 的 name + version。
 *
 * 【坑 2】同一个包在 .pnpm 下可能有多个版本的目录（例如 cordis 4.0.5 / 4.1.0），
 *   必须挑 version 完全等于目标版本的那个。
 */
function findStorePackage(name, version, { pnpmDir } = {}) {
  const hits = [];
  for (const dir of pnpmDirs()) {
    if (pnpmDir && dir !== pnpmDir) continue;
    const pkgDir = path.join(dir, 'node_modules', name);
    const pj = path.join(pkgDir, 'package.json');
    if (!existsSync(pj)) continue;
    let meta;
    try {
      meta = readJsonFile(pj);
    } catch {
      continue;                                        // 半损坏的目录：跳过而不是崩
    }
    if (meta.name === name && meta.version === version) hits.push(pkgDir);
  }
  return hits;                                          // 已按目录名排序，结果确定
}

/** 挑选唯一目标：优先沿用现有 junction 已经指向的目录，其次取排序第一个。 */
function chooseStorePackage(name, version, currentLink) {
  const hits = findStorePackage(name, version);
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0];
  if (currentLink) {
    try {
      const now = readlinkSync(currentLink);
      const match = hits.find((h) => sameDir(h, now));
      if (match) return match;
    } catch { /* 不是 link 或读不到：忽略 */ }
  }
  return hits[0];
}

/** 安全删除一个既有的 link / 目录槽位。 */
function removeLinkSlot(p) {
  const st = lstatSync(p);
  if (st.isSymbolicLink()) {
    // 【坑 3】junction 千万不要用 rmSync({recursive:true}) 删：
    //   它在 Windows 上可能顺着 reparse point 把**目标目录的内容**清掉 —— 那是 pnpm store。
    //   unlinkSync 只摘掉链接本身。
    unlinkSync(p);
    return 'unlink';
  }
  // 真是普通目录（有人拷了实体过来）才允许递归删。
  rmSync(p, { recursive: true, force: true });
  return 'rmdir';
}

/**
 * 幂等地把 dirPath 建成 → targetPath 的 junction。
 * 返回 'created' | 'repaired' | 'ready'。
 */
function ensureJunction(dirPath, targetPath, { label = dirPath } = {}) {
  const target = path.resolve(targetPath);

  // 【坑 4】junction 的目标必须是绝对路径，相对路径在 Windows 上会建出坏链接。
  if (!path.isAbsolute(target)) throw new Error(`junction 目标必须是绝对路径：${target}`);
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error(`junction 目标目录不存在：${target}`);
  }

  // 重建前先把「原指向」抓下来：重建之后再 readlink 只会读到新目标，
  // 日志就会把新目标谎报成「原指向」（曾经真的这么错过）。
  const previous = readJunctionTarget(dirPath);

  if (existsSync(dirPath)) {
    const st = lstatSync(dirPath);
    if (st.isSymbolicLink()) {
      if (previous && sameDir(previous, target)) return { status: 'ready', previous };
      if (CHECK_ONLY) return { status: 'repaired', previous };   // 只报告「会重建」
      removeLinkSlot(dirPath);
      symlinkSync(target, dirPath, 'junction');
      return { status: 'repaired', previous };
    }
    // 槽位被真实文件/目录占了
    if (CHECK_ONLY) return { status: 'repaired', previous };
    removeLinkSlot(dirPath);
    symlinkSync(target, dirPath, 'junction');
    return { status: 'repaired', previous };
  }

  if (CHECK_ONLY) return { status: 'created', previous };
  mkdirSync(path.dirname(dirPath), { recursive: true });
  symlinkSync(target, dirPath, 'junction');
  return { status: 'created', previous };
}

function readJunctionTarget(p) {
  try {
    return lstatSync(p).isSymbolicLink() ? readlinkSync(p) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 统计
// ---------------------------------------------------------------------------

const stats = { changed: 0, skipped: 0, failed: 0, pending: 0 };
const failures = [];          // 失败项描述

function ok(msg) { out(`  ✓ ${msg}`); }
function skip(msg) { stats.skipped++; out(`  · ${msg}`); }
function need(msg) { stats.pending++; out(`  ! ${msg}`); }
function fail(msg) {
  stats.failed++;
  failures.push(msg);
  out(`  ✗ ${msg}`);
}

// ---------------------------------------------------------------------------
// [1/5] 修复 0.1.1 缺件
// ---------------------------------------------------------------------------

/**
 * 找出 pnpm store 里所有 plugin-graph-and-blocks 的副本。
 *
 * 为什么要「全部」而不是某一个：路径 node_modules\@oh-my-student\plugin-graph-and-blocks
 * 是相对 profile 的解析链说的。真实解析链是
 *   profile\node_modules\@oh-my-student\dsh-bundle（指向 .pnpm\@oh-my-student+dsh-bundle@f_*）
 *     → 它自己的 node_modules\@oh-my-student\plugin-graph-and-blocks（再指到某个 @oh-my-student+plugin-graph_*）
 * 而锁文件里同时留着多个 dsh-bundle 副本，指向不同 plugin-graph 副本。
 * adapter 用的是 require.resolve（从它自己所在位置解析）——也就是**当前这个 bundle 指向的**那一份。
 * 只修一份很容易修错人（曾经发生过：修好的那份不是 profile 根 link 指向的那份）。
 * 所以：所有副本都对齐，幂等且与解析顺序无关。
 */
function findGraphCopies() {
  const byReal = new Map();
  for (const dir of pnpmDirs()) {
    const pkgDir = path.join(dir, 'node_modules', '@oh-my-student', 'plugin-graph-and-blocks');
    const pj = path.join(pkgDir, 'package.json');
    if (!existsSync(pj)) continue;
    try {
      const meta = readJsonFile(pj);
      if (meta.name !== GRAPH_PKG) continue;
      // 【坑 6】按 realpath 去重：@oh-my-student+dsh-bundle@* 自己的 node_modules 里也有一条
      //   plugin-graph-and-blocks 的 symlink，指回 @oh-my-student+plugin-graph_*。
      //   不 deref 就会把同一份物理文件当成 N 份副本，日志重复、还会重复备份。
      const real = realpathSync(pkgDir);
      const prev = byReal.get(real);
      // 优先用 @oh-my-student+plugin-graph_* 这个「正经 store 目录」当标签，
      // 而不是先碰到的 @oh-my-student+dsh-bundle@* 别名。
      const nicer = path.basename(dir).startsWith('@oh-my-student+plugin-graph');
      if (!prev) byReal.set(real, { dir: real, version: meta.version, label: path.basename(dir) });
      else if (nicer && !prev.label.startsWith('@oh-my-student+plugin-graph')) prev.label = path.basename(dir);
    } catch { /* 坏目录跳过 */ }
  }
  return [...byReal.values()].sort((a, b) => a.dir.localeCompare(b.dir));
}

function step1() {
  out(`[1/5] 补 0.1.1 缺件（${SOURCE_PATCHES.map((p) => path.basename(p.target)).join(' / ')}）`);

  for (const p of SOURCE_PATCHES) {
    if (!existsSync(p.vendor)) {
      fail(`缺件源文件不存在：${p.vendor}`);
    }
  }
  if (stats.failed > 0) {
    out('  ✗ 缺件源文件缺失，无法继续（步骤 1 失败即退出）');
    process.exit(1);
  }

  const copies = findGraphCopies();
  if (copies.length === 0) {
    fail(`pnpm store 里找不到 ${GRAPH_PKG}，无法修复`);
    out('  ✗ 步骤 1 失败即退出');
    process.exit(1);
  }

  // 标出「当前生效」的那一份：adapter 用 require.resolve 从自身位置解析。
  // 注意 pnpm 的目录布局是 <pnpmDir>/node_modules/@oh-my-student/dsh-bundle，
  // 所以解析会往上走到 <pnpmDir>/node_modules 才命中 plugin-graph-and-blocks 的 symlink。
  // 这里按 Node 的向上查找顺序真实地走一遍，而不是猜目录名。
  let liveGraph = null;
  try {
    const found = resolveAdapterPath();
    if (found) {
      for (let d = path.dirname(found.adapter); ; d = path.dirname(d)) {
        const cand = path.join(d, 'node_modules', '@oh-my-student', 'plugin-graph-and-blocks');
        if (existsSync(cand)) { liveGraph = realpathSync(cand); break; }
        if (path.dirname(d) === d) break;
      }
    }
  } catch { /* 拿不到就都当普通副本 */ }
  const isLive = (dir) => liveGraph && sameDir(dir, liveGraph);
  copies.sort((a, b) => (isLive(a.dir) ? -1 : isLive(b.dir) ? 1 : a.dir.localeCompare(b.dir)));

  out(`  发现 ${copies.length} 份副本${liveGraph ? '（* = 当前 adapter 实际加载的那份）' : ''}`);

  let touched = 0;
  for (const copy of copies) {
    const star = isLive(copy.dir) ? '*' : ' ';

    for (const p of SOURCE_PATCHES) {
      const dst = path.join(copy.dir, p.target);
      const vendHash = sha256(p.vendor);
      const rel = `${star}${copy.label}/${p.target.split(path.sep).join('/')}`;

      // 已修判定：文件存在且 sha256 与 vendor 原件一致
      if (existsSync(dst) && sha256(dst) === vendHash) {
        skip(`${rel} 已与 vendor 一致（${shortHash(vendHash)}）`);
        continue;
      }

      if (CHECK_ONLY) {
        need(`${rel} 需修复（目标${existsSync(dst) ? '内容不符' : '文件缺失'}，应为 ${shortHash(vendHash)}）`);
        continue;
      }

      // 备份：<name>.before-repair.js；已有 .before-repair.js 或 .bak.js 则不覆盖
      if (existsSync(dst)) {
        const base = dst.slice(0, -'.js'.length);
        const backup = `${base}.before-repair.js`;
        const legacyBak = path.join(path.dirname(dst), path.basename(base) + '.bak.js');
        if (!existsSync(backup) && !existsSync(legacyBak)) {
          copyFileSync(dst, backup);
          out(`    ⌦ 已备份现有文件 → ${path.basename(backup)}`);
        } else {
          out(`    ⌦ 已有备份（${path.basename(existsSync(backup) ? backup : legacyBak)}），保留不覆盖`);
        }
      }

      mkdirSync(path.dirname(dst), { recursive: true });
      copyFileSync(p.vendor, dst);

      // 复制后必须校验：不一致就是硬错误（步骤 1 校验失败必须退出 1）
      const got = sha256(dst);
      if (got !== vendHash) {
        out(`  ✗ ${rel} 复制后 sha256 校验失败（期望 ${shortHash(vendHash)}，实得 ${shortHash(got)}）`);
        out('  ✗ 步骤 1 校验失败，退出（退出码 1）');
        process.exit(1);
      }
      stats.changed++;
      touched++;
      ok(`${rel} 已写入（${shortHash(got)}）— ${p.why}`);
    }
  }

  if (touched === 0 && stats.pending === 0) {
    out(`  · ${copies.length} 份副本全部已就绪，无需改动`);
  }
}

// ---------------------------------------------------------------------------
// [2/5] 重建 host-targets junction 农场
// ---------------------------------------------------------------------------

function step2() {
  out('[2/5] 重建 host-targets 下 6 个 junction → pnpm store 真实目录');

  for (const name of HOST_PACKAGES) {
    const full = `@deepseek-ai/${name}`;
    const link = path.join(HOST_TARGETS, name);

    // dsh-client-ui-primitives@0.2.2-rc.1 不在 dsh-web-app 的依赖树里，
    // 是单独 pnpm add 装的 —— 但它落在同一个 .pnpm，定位方式完全一样。
    const target = chooseStorePackage(full, DSH_VERSION, link);
    if (!target) {
      fail(`${name}：pnpm store 里找不到 ${full}@${DSH_VERSION}`);
      continue;
    }

    try {
      const { status, previous } = ensureJunction(link, target, { label: name });
      if (status === 'ready') {
        skip(`${name} → 已指向 ${target}（跳过：目标一致）`);
      } else if (CHECK_ONLY) {
        need(`${name}：需修复（当前 ${previous ?? '非 junction'}，应指向 ${target}）`);
      } else if (status === 'created') {
        stats.changed++;
        ok(`${name} → 已创建 junction ${target}`);
      } else {
        stats.changed++;
        ok(`${name} → 已重建 junction ${target}（原指向 ${previous ?? '非 junction/空槽位'} 已被替换）`);
      }
    } catch (e) {
      fail(`${name}：${e.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// [3/5] 跑 Notara host-adapter
// ---------------------------------------------------------------------------

/**
 * 定位 host-adapter.mjs 的**真实路径**。
 *
 * 【坑 5】必须走 pnpm store 的真实路径，不能用 profile 根下的 symlink 路径。
 *   adapter 的 CLI 分支挂在 `if (process.argv[1] === fileURLToPath(import.meta.url))` 上。
 *   经 symlink 调用时 argv[1] 是 symlink 路径，而 import.meta.url 是真身路径，
 *   两者不相等 → 整个 CLI 分支被跳过 → 静默 exit 0，什么都不做（最坑的那种「看起来成功」）。
 */
function resolveAdapterPath() {
  const viaLink = path.join(PROFILE_NM, '@oh-my-student', 'dsh-bundle');
  try {
    const real = realpathSync(viaLink);                 // 解开 profile 根的 symlink
    const p = path.join(real, 'host-adapter.mjs');
    if (existsSync(p)) return { adapter: p, bundleDir: real };
  } catch { /* 没有这个 link：退回扫描 */ }

  const candidates = pnpmDirs()
    .filter((d) => path.basename(d).startsWith('@oh-my-student+dsh-bundle@'))
    .map((d) => path.join(d, 'node_modules', '@oh-my-student', 'dsh-bundle'))
    .filter((p) => existsSync(path.join(p, 'host-adapter.mjs')));

  if (candidates.length === 0) return null;
  return { adapter: path.join(candidates[0], 'host-adapter.mjs'), bundleDir: candidates[0] };
}

/** 从 adapter --check 的输出里抽出 {key: {patched, current}}。 */
function parseAdapterCheck(text) {
  const entries = new Map();
  const res = [
    /([A-Za-z0-9_]+)\s*:\s*\{([^{}]*?)\}/g,
  ];
  for (const re of res) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const body = m[2];
      const pm = /patched:\s*(true|false)/.exec(body);
      const cm = /current:\s*(true|false)/.exec(body);
      if (pm && cm) entries.set(m[1], { patched: pm[1] === 'true', current: cm[1] === 'true' });
    }
  }
  return entries;
}

function runAdapter(adapter, args) {
  return spawnSync(process.execPath, [adapter, ...args], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
}

function step3() {
  const chatDir = path.join(HOST_TARGETS, 'dsh-client-ui-chat');
  out(`[3/5] 运行 host-adapter（--host ${chatDir}）`);

  const found = resolveAdapterPath();
  if (!found) {
    fail(`找不到 host-adapter.mjs（${PROFILE_NM}\\.pnpm\\@oh-my-student+dsh-bundle@*\\node_modules\\${BUNDLE_PKG}）`);
    return;
  }
  ok(`adapter 真实路径：${found.adapter}`);

  if (!existsSync(chatDir) || !statSync(chatDir).isDirectory()) {
    fail(`--host 目录不可用：${chatDir}`);
    return;
  }

  // 先跑一次 --check：它内部对所有目标只做 check:true 校验、不写盘。
  // 用它做「已就绪」判定，重复执行时就能完全不碰文件（真幂等，而不是 repair 一遍再修回来）。
  const pre = runAdapter(found.adapter, ['--host', chatDir, '--check']);
  const preOut = pre.stdout ?? '';
  const preErr = pre.stderr ?? '';
  const preEntries = parseAdapterCheck(preOut);
  const preClean = pre.status === 0
    && preEntries.size > 0
    && [...preEntries.values()].every((v) => v.patched && v.current);

  if (CHECK_ONLY) {
    if (preOut.trim()) out(indent(preOut.trimEnd()));
    if (pre.status !== 0) {
      if (preErr.trim()) out(indent(preErr.trimEnd().split('\n').slice(0, 6).join('\n')));
      need('host-adapter --check 失败（上面是原始输出；最常见原因：步骤 1 的缺件还没补）');
      return;
    }
    let bad = 0;
    for (const [key, v] of preEntries) {
      if (v.patched && v.current) skip(`${key}: patched=true current=true`);
      else { bad++; need(`${key}: patched=${v.patched} current=${v.current}`); }
    }
    if (preEntries.size === 0) need('--check 输出无法解析为 patched/current 结构');
    else if (bad === 0) out(`  · ${preEntries.size} 个目标全部 patched=true current=true`);
    return;
  }

  if (preClean) {
    out('  · host 补丁已全部就位，跳过 --restore/apply（幂等：不重写任何文件）');
    for (const key of preEntries.keys()) skip(`${key}: patched=true current=true`);
    return;
  }

  // 1) --restore：回到未打补丁状态。首次可能本来就没补丁 → 失败不致命。
  const restore = runAdapter(found.adapter, ['--host', chatDir, '--restore']);
  if (restore.status !== 0) {
    out('  ⌦ --restore 非零退出（首次可能本来就没打补丁），按设计继续');
    const err = (restore.stderr ?? '').trim().split('\n').slice(0, 4).join('\n');
    if (err) out(indent(err));
  } else if ((restore.stdout ?? '').trim()) {
    out(indent((restore.stdout).trimEnd()));
  }

  // 2) apply：写入补丁
  const apply = runAdapter(found.adapter, ['--host', chatDir]);
  if (apply.status !== 0) {
    fail(`host-adapter 写入失败（退出码 ${apply.status}）`);
    const err = (apply.stderr ?? '').trim().split('\n').slice(0, 12).join('\n');
    if (err) out(indent(err));
    return;
  }
  stats.changed++;
  ok(`apply 完成：${((apply.stdout ?? '').trim() || 'Host adapter updated').split('\n')[0]}`);

  // 3) --check：校验 chat / math / web / entry / skill / trigger 六个目标 patched+current
  const chk = runAdapter(found.adapter, ['--host', chatDir, '--check']);
  const stdout = chk.stdout ?? '';
  const stderr = chk.stderr ?? '';
  if (stdout.trim()) out(indent(stdout.trimEnd()));

  const entries = parseAdapterCheck(stdout);
  const anyFalse = /current:\s*false/.test(stdout);
  let bad = 0;
  for (const [key, v] of entries) {
    if (v.patched && v.current) skip(`${key}: patched=true current=true`);
    else { bad++; fail(`${key}: patched=${v.patched} current=${v.current}`); }
  }
  if (chk.status !== 0 || anyFalse || bad > 0) {
    if (entries.size === 0) {
      fail(`--check 输出无法解析（退出码 ${chk.status}）`);
      if (stderr.trim()) out(indent(stderr.trimEnd().split('\n').slice(0, 12).join('\n')));
    }
  } else if (entries.size === 0) {
    ok('--check 通过（无结构化输出，退出码 0）');
  }
}

const indent = (s) => s.split('\n').map((l) => '      ' + l).join('\n');

// ---------------------------------------------------------------------------
// [4/5] 校验 skills junction + SKILL.md frontmatter
// ---------------------------------------------------------------------------

function step4() {
  out(`[4/5] 校验 skills junction（${SKILLS_DST} → ${SKILLS_SRC}）`);

  if (!existsSync(SKILLS_SRC)) {
    fail(`skill 真源目录不存在：${SKILLS_SRC}`);
    return;
  }

  for (const name of SKILL_NAMES) {
    const src = path.join(SKILLS_SRC, name);
    const dst = path.join(SKILLS_DST, name);

    // 真源自检：SKILL.md 存在且首行是 frontmatter 分隔符 ---
    const skillMd = path.join(src, 'SKILL.md');
    if (!existsSync(skillMd)) {
      fail(`${name}：真源缺 SKILL.md（${skillMd}）`);
      continue;
    }
    const firstLine = (readFileSync(skillMd, 'utf8').split(/\r?\n/, 1)[0] ?? '').trim();
    if (firstLine !== '---') {
      fail(`${name}：SKILL.md 首行不是 frontmatter 的 '---'（实得 '${firstLine.slice(0, 40)}'）`);
      continue;
    }

    try {
      const { status } = ensureJunction(dst, src, { label: name });
      if (status === 'ready') {
        skip(`${name} → junction 已就绪（跳过：目标一致）`);
      } else if (CHECK_ONLY) {
        need(`${name}：需${status === 'created' ? '创建' : '重建'} junction → ${src}`);
      } else {
        stats.changed++;
        ok(`${name} → junction ${status === 'created' ? '已创建' : '已重建'} → ${src}`);
      }
    } catch (e) {
      fail(`${name}：${e.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// [5/5] 资料库文件删除补丁（patch-vault-delete.mjs）
// ---------------------------------------------------------------------------

function step5() {
  out(`[5/5] 资料库文件删除补丁（patch-vault-delete.mjs）`);
  const patch = path.join(INSTANCE_DIR, 'patch-vault-delete.mjs');
  if (!existsSync(patch)) {
    fail(`找不到 patch-vault-delete.mjs（${patch}）`);
    return;
  }
  // patch 脚本默认从它自己的上级目录找 .dsh-studier-home；这里用 --dsh-home 指定的
  // 路径显式覆盖，保证 repair 与 patch 指向同一个 profile。
  const env = {
    ...process.env,
    DSH_PROFILE_NODE_MODULES: path.join(DSH_HOME, 'profiles', 'web', 'node_modules'),
  };
  const mode = CHECK_ONLY ? '--check' : '--apply';
  const r = spawnSync(process.execPath, [patch, mode], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env });
  const tail = ((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-6).map((l) => '      ' + l).join('\n');
  if (r.status === 0) {
    if (CHECK_ONLY) skip('资料库删除补丁已全副本生效');
    else ok('资料库删除补丁：所有副本已就绪（幂等）');
  } else if (CHECK_ONLY) {
    need('资料库删除补丁尚未打全（重新运行不带 --check 即可修复）');
    if (tail) out(tail);
  } else {
    fail(`资料库删除补丁执行失败（退出码 ${r.status}）`);
    if (tail) out(tail);
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function preflight() {
  if (argvUnknown.length > 0) {
    out(`未知参数：${argvUnknown.join(' ')}（只支持 --check / --dsh-home <路径>）`);
    process.exit(2);
  }
  if (!existsSync(DSH_HOME)) {
    out(`DSH_HOME 不存在：${DSH_HOME}`);
    out('本实例的运行时默认在 E:\\studier\\.dsh-studier-home；要用别处请加 --dsh-home <路径>');
    process.exit(1);
  }
  if (!existsSync(PNPM_DIR)) {
    out(`pnpm store 不存在：${PNPM_DIR}（先在 profile 里 pnpm install）`);
    process.exit(1);
  }
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    out('用法：node repair.mjs [--check] [--dsh-home <路径>]');
    out('  --check            只检查不修改；退出码 0 = 全部已就绪');
    out('  --dsh-home <路径>   覆盖运行时根目录（默认 <脚本上级>\\\\.dsh-studier-home）');
    return;
  }

  preflight();

  out(`studier DSH 实例${CHECK_ONLY ? '体检（--check，只读）' : '一键修复'}`);
  out(`  DSH_HOME = ${DSH_HOME}`);
  out('');

  step1();
  step2();
  step3();
  step4();
  step5();

  out('');
  if (CHECK_ONLY) {
    if (stats.pending === 0 && stats.failed === 0) {
      out(`全部已就绪（${stats.skipped} 项无需改动）`);
      process.exitCode = 0;
    } else {
      out(`有 ${stats.pending + stats.failed} 项需修复（重新运行不带 --check 即可修复）`);
      process.exitCode = 1;
    }
  } else {
    if (stats.failed === 0) {
      out(`修复完成（改动 ${stats.changed} 项 / 跳过 ${stats.skipped} 项）`);
      if (stats.changed > 0) out('提示：host 补丁改动需要重启 DSH 实例并刷新页面才生效。');
      process.exitCode = 0;
    } else {
      out(`有 ${stats.failed} 项失败：`);
      for (const f of failures) out(`  - ${f}`);
      process.exitCode = 1;
    }
  }
}

main();
