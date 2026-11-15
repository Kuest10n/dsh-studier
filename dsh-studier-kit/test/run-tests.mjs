// dsh-studier-kit 回归测试：用临时 fixture vault 驱动 5 个工具，断言方法论规则。
// 运行： node E:\studier\dsh-studier-kit\test\run-tests.mjs
// 设计：不依赖 DSH 运行时——用假 ctx 捕获 tools.register 的工具对象，直接调 execute()。

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const today = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
const p = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
const addDays = (base, n) => { const x = new Date(base.getTime()); x.setDate(x.getDate() + n); return x; };
const d = (offset) => fmt(addDays(today, offset));
const isSaturday = (s) => { const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/); return m && new Date(+m[1], +m[2] - 1, +m[3]).getDay() === 6; };

const root = await mkdtemp(path.join(tmpdir(), 'studier-fixture-'));
const wa = (name, fm, body = '\n## 我的错因\n\n（手写区，AI 不写）\n') =>
  writeFile(path.join(root, '10知识', '错题本', name), `---\n${fm.join('\n')}\n---\n${body}`, 'utf8');
const node = (name, fm) => writeFile(path.join(root, '10知识', '知识树', '数学', name), `---\n${fm.join('\n')}\n---\n# ${name}\n`, 'utf8');

await mkdir(path.join(root, '10知识', '错题本'), { recursive: true });
await mkdir(path.join(root, '10知识', '知识树', '数学'), { recursive: true });
await mkdir(path.join(root, '50指标'), { recursive: true });

// --- 错题：覆盖 ★/半会/不会/会/已掌握/无日期/边界到期 ---
await wa('w1.md', [
  `date: ${d(-14)}`, 'subject: 数学', '题号: 7', 'score_full: 12', 'score_got: 0',
  'self_state: 不会', 'star: true', 'kp: ["[[数学/math-b1-01|集合的概念]]"]', 'wrong_reason: 知识',
  'review_count: 0', 'last_review:', 'mastered: false',
]);
await wa('w2.md', [
  `date: ${d(-8)}`, 'subject: 数学', '题号: 9', 'score_full: 12', 'score_got: 6',
  'self_state: 半会', 'star: false', 'kp: []', 'wrong_reason: 执行',
  'review_count: 2', `last_review: ${d(-2)}`, 'mastered: false',
]);
await wa('w3.md', [
  `date: ${d(-30)}`, 'subject: 数学', '题号: 3', 'score_full: 10', 'score_got: 10',
  'self_state: 会', 'star: false', 'kp: []', 'wrong_reason: 执行',
  'review_count: 3', `last_review: ${d(-3)}`, 'mastered: true',
]);
await wa('w4.md', [
  `date: ${d(-20)}`, 'subject: 数学', '题号: 11', 'score_full: 10', 'score_got: 10',
  'self_state: 会', 'star: false', 'kp: []', 'wrong_reason: 执行',
  'review_count: 0', `last_review: ${d(-9)}`, 'mastered: false',
]);
await wa('w5.md', [
  `date: ${d(-20)}`, 'subject: 数学', '题号: 12', 'score_full: 10', 'score_got: 2',
  'self_state: 不会', 'star: false', 'kp: []', 'wrong_reason: 熟练',
  'review_count: 0', `last_review: ${d(-3)}`, 'mastered: false',
]);
await wa('w6.md', [
  'subject: 物理', '题号: 2', 'score_full: 8', 'score_got: 3',
  'self_state: 不会', 'star: false', 'kp: []', 'wrong_reason: 知识', 'review_count: 0', 'last_review:',
]);
await wa('w7.md', [
  `date: ${d(-6)}`, 'subject: 数学', '题号: 13', 'score_full: 10', 'score_got: 5',
  'self_state: 半会', 'star: false', 'kp: []', 'wrong_reason: 执行',
  'review_count: 1', `last_review: ${d(-5)}`, 'mastered: false',
]);
await wa('w8.md', [
  `date: ${d(-5)}`, 'subject: 数学', '题号: 14', 'score_full: 10', 'score_got: 4',
  'self_state: 半会', 'star: false', 'kp: ["[[math-ghost]]"]', 'wrong_reason: 知识',
  'review_count: 0', `last_review: ${d(-1)}`, 'mastered: false',
]);

// --- 知识树节点 ---
await node('math-b1-01.md', [
  'id: math-b1-01', 'name: 集合的概念', 'subject: 数学', 'type: concept', 'authority: textbook',
  'needs_review: true', 'freq: high', 'status: done', 'self_state: 半会', 'prereq: []', 'source_question: []',
]);
await node('math-b1-02.md', [
  'id: math-b1-02', 'name: 集合的关系', 'subject: 数学', 'type: concept', 'authority: textbook',
  'needs_review: false', 'freq: medium', 'status: done', 'self_state: 不会',
  'prereq: ["[[数学/math-b1-01|集合的概念]]"]', 'source_question: []',
]);
// 未核对的 ai 节点：必须不进复习池（vault 纪律）
await node('math-ai-01.md', [
  'id: math-ai-01', 'name: AI估计的考点', 'subject: 数学', 'type: concept', 'authority: ai-generated',
  'needs_review: true', 'freq: high', 'status: done', 'self_state: 半会', 'prereq: []', 'source_question: []',
]);
await node('math-todo-01.md', [
  'id: math-todo-01', 'name: 未开始的考点', 'subject: 数学', 'type: concept', 'authority: textbook',
  'needs_review: false', 'freq: high', 'status: todo', 'self_state: 不会', 'prereq: []', 'source_question: []',
]);
await node('math-dang-01.md', [
  'id: math-dang-01', 'name: 悬空双链考点', 'subject: 数学', 'type: concept', 'authority: textbook',
  'needs_review: false', 'freq: low', 'status: learning', 'self_state: 不会',
  'prereq: ["[[math-ghost-99]]"]', 'source_question: []',
]);
// 没有 frontmatter 的笔记页：不算节点，但必须在「跳过」里报出来（否则 74 文件→73 节点像个 bug）
await writeFile(path.join(root, '10知识', '知识树', '数学', '索引.md'), '# 数学考点索引\n\n（纯笔记，无 frontmatter）\n', 'utf8');

// --- 卡片三文件：math-b1-01 齐三件（可比对），math-b1-02 只手写缺 AI ---
await mkdir(path.join(root, '10知识', '卡片'), { recursive: true });
const card = (name) => writeFile(path.join(root, '10知识', '卡片', name), '---\nkp: x\n---\n# 正面\n\n问题\n', 'utf8');
await card('math-b1-01.my.md');
await card('math-b1-01.ai.md');
await card('math-b1-01.verdict.md');
await card('math-b1-02.my.md');

// --- 指标表：★1 行、1 行实得留空（不进分母）、frontmatter 故意写错满分与 rate ---
await writeFile(path.join(root, '50指标', '2026-11-01-数学-第9次周考.md'), `---
date: 2026-11-01
exam: 第9次周考
subject: 数学
score_full_total: 34
score_got_total: 16
rate: 0.4706
star_count: 1
---

| 题号 | 满分 | 实得 | 三态 | ★ | 题干一句话 | 知识点 | 错因类型 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 7 | 12 |  | 不会 | ★ | 集合判断 |  |  |
| 9 | 12 | 6 | 半会 |  | 集合运算 |  |  |
| 10 | 10 | 10 | 会 |  | 求参数 |  |  |
| 15 | 10
`, 'utf8');

// --- 第二份指标表：取值写错（三态「半会了」、错因「计算」）必须被校验拦下来 ---
await writeFile(path.join(root, '50指标', '2026-11-08-数学-第10次周考.md'), `---
date: 2026-11-08
exam: 第10次周考
subject: 数学
score_full_total: 12
score_got_total: 6
rate: 0.5
star_count: 0
---

| 题号 | 满分 | 实得 | 三态 | ★ | 题干一句话 | 知识点 | 错因类型 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 6 | 3 | 半会了 |  | 求导 |  | 计算 |
| 2 | 6 | 3 | 半会 |  | 单调性 |  | 执行 |
`, 'utf8');

// --- 载入插件，用假 ctx 捕获工具 ---
const mod = await import(pathToFileURL('E:\\studier\\dsh-studier-kit\\index.js').href);
const tools = new Map();
mod.apply({ tools: { register: (t) => tools.set(t.name, t) } }, { vaultRoot: root });

const call = async (name, args = {}) => tools.get(name).execute(args);

// --- 断言框架 ---
let pass = 0; const failures = [];
const test = async (label, fn) => {
  try { await fn(); pass += 1; console.log(`  ✓ ${label}`); }
  catch (e) { failures.push({ label, error: e.message }); console.log(`  ✗ ${label}\n      ${String(e.message).split('\n')[0]}`); }
};

const filesOf = (arr) => arr.map((x) => path.basename(x.file));

console.log(`fixture vault = ${root}\ntoday = ${fmt(today)}\n`);
console.log('注册的工具：', [...tools.keys()].join(', '));
assert.equal(tools.size, 5, '应当注册 5 个工具');

console.log('\n[1] studier_review_pool');
const rp = await call('studier_review_pool');
await test('错题池：★/半会/不会 入池，已掌握的会 不入池', () => {
  const names = filesOf(rp.pool.filter((x) => x.source === '错题'));
  assert.deepEqual(names.sort(), ['w1.md', 'w2.md', 'w5.md', 'w6.md', 'w7.md', 'w8.md']);
});
await test('节点池：只收 done 的半会/不会', () => {
  const names = filesOf(rp.pool.filter((x) => x.source === '节点'));
  assert.deepEqual(names.sort(), ['math-b1-01.md', 'math-b1-02.md']);
});
await test('BUG-1 未核对的 ai-generated 节点不得进池', () => {
  const ids = rp.pool.filter((x) => x.source === '节点').map((x) => x.id);
  assert.ok(!ids.includes('math-ai-01'), `未核对 ai 节点进了池：${ids.join(',')}`);
});
await test('排除计数与扫描计数正确', () => {
  assert.equal(rp.excluded.unverified_ai_nodes, 1);
  assert.equal(rp.excluded.非done节点, 2, '非 done 节点应为 math-todo-01 + math-dang-01');
  assert.equal(rp.excluded.已掌握错题, 1);
  assert.equal(rp.scanned.错题本文件, 8);
  assert.equal(rp.scanned.知识树节点, 5, '节点数不含索引.md');
  assert.equal(rp.scanned.知识树文件, 6, '文件数含索引.md');
  assert.equal(rp.scanned.知识树跳过, 1);
});
await test('排序：freq high 在 medium 之前；失分多的在前', () => {
  const first = rp.pool[0];
  assert.equal(first.source, '节点');
  assert.equal(first.id, 'math-b1-01', '第一个应为 freq=high 且失分 12、被依赖 1 次的那个节点');
  assert.equal(first.prereq_in, 1);
  assert.equal(first.失分, 12);
});
await test('subject 过滤生效', async () => {
  const only = await call('studier_review_pool', { subject: '物理' });
  assert.equal(only.counts.pool, 1);
  assert.equal(path.basename(only.pool[0].file), 'w6.md');
});
await test('卡片就绪度：三件齐的节点可进比对，缺 AI 的不算 ready', () => {
  const byId = new Map(rp.pool.filter((x) => x.source === '节点').map((x) => [x.id, x]));
  const a = byId.get('math-b1-01');
  assert.equal(a.cards.my, true); assert.equal(a.cards.ai, true); assert.equal(a.cards.verdict, true);
  assert.equal(a.cards.ready, true, 'my+ai 都在时应 ready=true');
  const b = byId.get('math-b1-02');
  assert.equal(b.cards.my, true); assert.equal(b.cards.ai, false);
  assert.equal(b.cards.ready, false, '缺 AI 卡时不能声称可比对');
});
await test('卡片就绪度：错题按 kp 双链查，没 kp 的记「完全没卡片」', () => {
  const byFile = new Map(rp.pool.filter((x) => x.source === '错题').map((x) => [path.basename(x.file), x]));
  assert.equal(byFile.get('w1.md').cards.ready, true, 'w1 的 kp 指向 math-b1-01，卡片齐 -> ready');
  assert.equal(byFile.get('w2.md').cards.missing_all, true, 'w2 没有 kp，应记 missing_all');
  assert.equal(byFile.get('w8.md').cards.missing_all, true, 'w8 的 kp 指向不存在的节点，卡片不存在');
});
await test('复习池汇总出卡片可判会 / 无卡片 两个数', () => {
  assert.equal(rp.counts['卡片可判会'], 2, '可进比对 = 错题 w1 + 节点 math-b1-01');
  assert.equal(rp.scanned.卡片文件, 4);
});
await test('render 里带上卡片标签（模型读到的就是这段文本）', () => {
  const text = tools.get('studier_review_pool').output.render({}, rp).map((b) => b.text).join('\n');
  assert.ok(text.includes('卡片: 手写✓/AI✓/判决✓（可进比对）'), '缺少三件齐的标签');
  assert.ok(text.includes('卡片: 无（先写手写卡）'), '缺少「完全没卡片」的标签');
  assert.ok(text.includes('卡片 4 个文件'), 'render 头部应报扫描到的卡片文件数');
});

console.log('\n[2] studier_tree_status');
const ts = await call('studier_tree_status');
await test('分布计数正确', () => {
  assert.equal(ts.totals.nodes, 5);
  assert.equal(ts.totals.by_status.done, 3);
  assert.equal(ts.totals.by_status.todo, 1);
  assert.equal(ts.totals.by_status.learning, 1);
});
await test('未核对 ai 节点被列出', () => {
  assert.equal(ts.unverified_ai.length, 1);
  assert.equal(ts.unverified_ai[0].id, 'math-ai-01');
});
await test('悬空 prereq 被列出', () => {
  assert.equal(ts.dangling.total, 1);
  assert.equal(ts.dangling.prereq[0].target, 'math-ghost-99');
});
await test('错题 kp 断链被列出', () => {
  const broken = ts.kp_broken.map((k) => k.target);
  assert.deepEqual(broken, ['math-ghost']);
});
await test('无 frontmatter 的笔记页要计入「跳过」而不是凭空消失', () => {
  assert.equal(ts.scanned['知识树文件'], 6, '扫描数应含 索引.md');
  assert.equal(ts.totals.nodes, 5, '索引.md 不算节点');
  assert.equal(ts.scanned['知识树跳过'], 1);
  assert.deepEqual(ts.skipped_files, ['索引.md']);
  const text = tools.get('studier_tree_status').output.render({}, ts).map((b) => b.text).join('\n');
  assert.ok(text.includes('跳过 1 个没有 id/name 的 md'), 'render 里要说明跳过了什么');
});

console.log('\n[6] vault 守卫（路径配错时不抛栈，给一句人话）');
{
  const guarded = new Map();
  mod.apply({ tools: { register: (t) => guarded.set(t.name, t) } }, { vaultRoot: path.join(root, 'vault-不存在') });
  await test('vault 不存在：5 个工具都返回 ok=false + 可读提示，render 不崩', async () => {
    for (const [name, tool] of guarded) {
      const value = await tool.execute({});
      assert.equal(value.ok, false, `${name} 应当返回 ok=false`);
      assert.equal(value.code, 'vault_missing', `${name} 的 code 应为 vault_missing`);
      assert.match(value.message, /cordis\.patch\.yml/, `${name} 应提示去哪里改配置`);
      const text = tool.output.render({}, value).map((b) => b.text).join('\n');
      assert.match(text, /vault 目录不存在/, `${name} 的 render 应打出人话而不是崩`);
    }
  });
  await test('vault 指向文件而不是目录：报 vault_not_directory', async () => {
    const badFile = path.join(root, '50指标', '2026-11-01-数学-第9次周考.md');
    const guarded2 = new Map();
    mod.apply({ tools: { register: (t) => guarded2.set(t.name, t) } }, { vaultRoot: badFile });
    const value = await guarded2.get('studier_review_pool').execute({});
    assert.equal(value.ok, false);
    assert.equal(value.code, 'vault_not_directory');
  });
}

console.log('\n[3] studier_intake_check');
const ic = await call('studier_intake_check');
// 文件顺序由 readdir 决定，别赌 results[0]：按文件名找
const metricOf = (frag) => {
  const hit = ic.results.find((r) => path.basename(r.file).includes(frag));
  assert.ok(hit, `找不到指标表 ${frag}`);
  return hit;
};
const m9 = metricOf('第9次');
await test('表算：实得留空的题不进分母', () => {
  const r = m9;
  assert.equal(r.computed.score_full_total, 22, '12(留空) 不进分母 → 12+10=22');
  assert.equal(r.computed.score_got_total, 16);
  assert.equal(r.computed.rate, 0.7273);
  assert.equal(r.computed.star_rows, 1);
  assert.equal(r.computed.rows, 3);
});
await test('留空行进入待核对清单', () => {
  assert.deepEqual(m9.pending_rows, ['7']);
  assert.ok(ic.pending_rows_total >= 1);
});
await test('frontmatter 写错被指出来（满分 + rate），写对的（实得/★）不误报', () => {
  const r = m9;
  assert.equal(r.ok, false);
  const joined = r.issues.join(' | ');
  assert.match(joined, /score_full_total/);
  assert.match(joined, /rate/);
  assert.doesNotMatch(joined, /score_got_total/);
  assert.doesNotMatch(joined, /star_count/);
});
await test('列数不足的行不能被静默吞掉', () => {
  const r = m9;
  assert.equal(r.skipped_rows, 1, '少写 | 的那一行应当被记为 skipped_rows');
  assert.match(r.issues.join(' | '), /列数不足/);
});
await test('取值域校验：三态/错因类型写错要报出来，写对的不报', () => {
  const r = metricOf('第10次');
  assert.equal(r.ok, false, '取值非法时整份表不能判 ok');
  const joined = r.issues.join(' | ');
  assert.match(joined, /三态=「半会了」/);
  assert.match(joined, /错因类型=「计算」/);
  assert.equal(r.invalid_rows.length, 2);
  assert.doesNotMatch(joined, /半会」/, '合法的半会不应被误报');
  assert.match(joined, /只能是 会\/半会\/不会/);
});

console.log('\n[4] studier_schedule');
const sc = await call('studier_schedule');
await test('到期判定：不会+1天 与 会+7天 应今天到期并算出逾期天数', () => {
  const names = filesOf(sc.due_today);
  assert.ok(names.includes('w4.md'), '会 rc0 last_review=-9 → 间隔7 → 到期 -2');
  assert.ok(names.includes('w5.md'), '不会 → 间隔1 → 到期 -2');
  const w4 = sc.due_today.find((x) => x.file.endsWith('w4.md'));
  assert.equal(w4.suggested_interval_days, 7);
  assert.equal(w4.overdue_days, 2);
});
await test('边界：到期日=今天算到期（不是未来）', () => {
  const w7 = sc.due_today.find((x) => x.file.endsWith('w7.md'));
  assert.ok(w7, '半会 rc1 间隔=5，last_review=-5 → 到期=今天，应算今天到期');
  assert.equal(w7.overdue_days, 0);
});
await test('半会间隔阶梯 = 3+2*rc，封顶 7', () => {
  const w2 = sc.upcoming.find((x) => x.file.endsWith('w2.md'));
  assert.ok(w2, '半会 rc2 → 间隔 7 → 到期 +5，应在未来 7 天内');
  assert.equal(w2.suggested_interval_days, 7);
});
await test('★错题只排周六', () => {
  const all = [...sc.due_today, ...sc.upcoming, ...(sc.later || [])];
  const w1 = all.find((x) => x.file.endsWith('w1.md'));
  assert.ok(w1, 'BUG-2 ★错题（无 last_review）不能凭空消失：应在某个桶里');
  assert.ok(isSaturday(w1.next_due), `★ 的 next_due 不是周六：${w1.next_due}`);
});
await test('三个桶的并集覆盖所有可算日期条目（不丢项）', () => {
  assert.ok(Array.isArray(sc.later), 'later 桶必须存在，否则超出窗口的条目会静默消失');
  const all = [...sc.due_today, ...sc.upcoming, ...sc.later, ...sc.never_reviewed];
  // fixture 里有 8 条错题（w3 已掌握退出）+ 5 个节点（只有 2 个 done 且半会/不会，1 个未核对）→ 9 条
  assert.equal(all.length, 9, `桶内条目应为 9，实际 ${all.length}：${filesOf(all).join(',')}`);
});
await test('从未复习桶：无日期的错题 + done 的半会/不会节点', () => {
  const names = filesOf(sc.never_reviewed);
  assert.ok(names.includes('w6.md'));
  assert.ok(names.includes('math-b1-01.md'));
  assert.ok(names.includes('math-b1-02.md'));
  assert.equal(sc.never_reviewed.length, 3);
});
await test('已掌握且会 的错题退出排期', () => {
  const all = [...sc.due_today, ...sc.upcoming, ...(sc.later || []), ...sc.never_reviewed];
  assert.ok(!filesOf(all).includes('w3.md'));
});
await test('排期里也带卡片就绪度，并可汇总', () => {
  const all = [...sc.due_today, ...sc.upcoming, ...(sc.later || []), ...sc.never_reviewed];
  const w1 = all.find((x) => path.basename(x.file) === 'w1.md');
  assert.equal(w1.cards.ready, true, 'w1 的 kp 卡片齐 -> ready');
  const node = all.find((x) => x.source === '节点' && x.id === 'math-b1-01');
  assert.equal(node.cards.ready, true, '节点 math-b1-01 卡片齐 -> ready');
  assert.equal(sc.counts['卡片可比对'], 2, '可进比对：w1 + math-b1-01');
  const text = tools.get('studier_schedule').output.render({}, sc).map((b) => b.text).join('\n');
  assert.ok(text.includes('卡片就绪（只看文件存在性）'), 'report 应有一段卡片就绪说明');
});

console.log('\n[5] studier_graph_map');
const gm = await call('studier_graph_map');
await test('双态投影：高危队列首位是 freq=high 且半会的节点', () => {
  assert.ok(gm.priority_queue.length >= 1);
  assert.equal(gm.priority_queue[0].id, 'math-b1-01');
});
await test('prereq 边与入度正确', () => {
  assert.ok(gm.counts.edges >= 1);
  assert.ok(gm.edges.some((e) => e.from === 'math-b1-01' && e.to === 'math-b1-02'));
});
await test('悬空双链在投影里也被标出来', () => {
  assert.ok(gm.counts.dangling >= 1);
});
await test('图谱也带卡片统计（只看文件存在性）', () => {
  assert.equal(gm.counts.cards_scanned, 4);
  assert.equal(gm.counts['卡片可比对'], 1, '只有 math-b1-01 是手写+AI 都齐');
  assert.equal(gm.counts['无卡片'], 3, 'math-ai-01 / math-todo-01 / math-dang-01 没有卡片');
  const node = gm.nodes.find((n) => n.id === 'math-b1-01');
  assert.deepEqual(node.cards, { my: true, ai: true, verdict: true });
});

// --- 清理 ---
await rm(root, { recursive: true, force: true });

console.log(`\n${'='.repeat(46)}`);
console.log(`通过 ${pass} 项，失败 ${failures.length} 项`);
if (failures.length) {
  for (const f of failures) console.log(`\n✗ ${f.label}\n  ${f.error}`);
  process.exitCode = 1;
}
