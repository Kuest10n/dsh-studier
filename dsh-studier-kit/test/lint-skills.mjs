// skills 一致性检查：SKILL.md 的 frontmatter 不合规时，DSH 会「静默」不把该 skill 列给模型，
// 表现成「明明写了却用不上」——所以要有这道机械检查。
// 运行： node E:\studier\dsh-studier-kit\test\lint-skills.mjs [skillsRoot]
// 默认检查 E:\studier\dsh-instance\skills（真源），并顺带核对 $DSH_HOME\skills 的 junction 是否指向真源。

import { readdir, readFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_ROOT = 'E:\\studier\\dsh-instance\\skills';
const RUNTIME_ROOT = 'E:\\studier\\.dsh-studier-home\\skills';

const root = process.argv[2] || DEFAULT_ROOT;
const problems = [];
const rows = [];

const dirs = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
if (dirs.length === 0) problems.push(`${root} 下没有任何 skill 目录`);

for (const name of dirs.sort()) {
  const dir = path.join(root, name);
  const skillFile = path.join(dir, 'SKILL.md');
  let text;
  try {
    text = await readFile(skillFile, 'utf8');
  } catch {
    problems.push(`${name}: 缺少 SKILL.md（DSH 只认 <dir>/SKILL.md）`);
    continue;
  }
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) { problems.push(`${name}: SKILL.md 第一行必须是 --- 包裹的 frontmatter`); continue; }
  const fm = m[1];
  const field = (k) => {
    const hit = fm.match(new RegExp(`^${k}\\s*:\\s*(.*)$`, 'm'));
    return hit ? hit[1].replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '') : null;
  };
  const fmName = field('name');
  const desc = field('description');
  const invocable = field('user-invocable');
  if (!fmName) problems.push(`${name}: frontmatter 缺 name`);
  else if (fmName !== name) problems.push(`${name}: frontmatter name=${fmName} 与目录名不一致（模型按 name 调用，会找不到）`);
  if (!desc) problems.push(`${name}: frontmatter 缺 description（模型靠它判断何时加载）`);
  else if (desc.length < 10) problems.push(`${name}: description 太短（${desc.length} 字），模型无法判断触发场景`);
  if (invocable !== 'true') problems.push(`${name}: user-invocable 不为 true（本人将无法手动点名调用）`);

  // 正文规模：太长会吃上下文，太短多半没写完
  const bodyLines = text.split(/\r?\n/).length;
  if (bodyLines < 20) problems.push(`${name}: 正文只有 ${bodyLines} 行，疑似没写完`);

  // 硬纪律自检：这些词必须出现在周考/判会类 skill 里，防止移植时被删掉
  const guards = {
    'studier-weekend-intake': ['我看到', '题号 | 满分 | 实得'],
    'studier-math-tutor': ['问题'],
    'studier-card-judge': ['双证据'],
    'studier-peer-test': ['.my.md'],
  }[name];
  for (const g of guards || []) {
    if (!text.includes(g)) problems.push(`${name}: 正文缺少关键纪律「${g}」（移植时被删掉了？）`);
  }

  rows.push({ name, lines: bodyLines, desc: desc ? desc.slice(0, 28) + (desc.length > 28 ? '…' : '') : '（缺）' });
}

// 运行时目录：应当是 junction（或至少内容一致）
const runtime = [];
try {
  for (const name of dirs) {
    const link = path.join(RUNTIME_ROOT, name);
    try {
      const st = await stat(link);
      const [rp, tp] = await Promise.all([realpath(link), realpath(path.join(root, name))]);
      runtime.push({ name, ok: rp === tp, target: rp });
      if (!ok(st) || rp !== tp) problems.push(`${name}: 运行时目录未指向真源（${link} → ${rp}）`);
    } catch {
      runtime.push({ name, ok: false, target: '（缺失）' });
      problems.push(`${name}: 运行时目录不存在（${link}），实例启动后模型看不到该 skill`);
    }
  }
} catch {
  problems.push(`运行时 skills 目录不存在：${RUNTIME_ROOT}`);
}
function ok(st) { return st.isDirectory() || st.isSymbolicLink(); }

console.log(`skills 真源：${root}`);
for (const r of rows) console.log(`  · ${r.name}（${r.lines} 行）— ${r.desc}`);
console.log(`\n运行时目录：${RUNTIME_ROOT}`);
for (const r of runtime) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name} → ${r.target}`);

if (problems.length) {
  console.log(`\n发现 ${problems.length} 个问题：`);
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exitCode = 1;
} else {
  console.log(`\n全部 ${dirs.length} 个 skill 合规 ✓`);
}
