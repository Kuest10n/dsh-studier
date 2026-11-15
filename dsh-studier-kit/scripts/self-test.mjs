// dsh-studier-kit 自测：不依赖 DSH 宿主，直接调 apply() 与三个工具（只读）
// 用法：node scripts/self-test.mjs

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply } from '../index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, '..');

const registered = [];
const fakeCtx = {
  tools: { register: (t) => registered.push(t) },
};
const config = { vaultRoot: process.env.STUDIER_VAULT || path.resolve(pluginRoot, '..', 'vault') };

const applyResult = apply(fakeCtx, config);
console.log(`[1] apply() 返回 ${Array.isArray(applyResult) ? applyResult.length : '非数组'} 项；注册工具：${registered.map((t) => t.name).join(', ')}`);

let failures = 0;

for (const tool of registered) {
  // 形状契约（对照 dsh-video-read）
  const shapeOk = tool && typeof tool.name === 'string' &&
    typeof tool.description === 'string' && tool.description.length > 10 &&
    tool.parameters && tool.parameters.type === 'object' &&
    typeof tool.execute === 'function' &&
    tool.output && tool.output.schema && typeof tool.output.render === 'function';
  if (!shapeOk) { console.log(`  ✗ ${tool.name}: 工具对象形状不符合契约`); failures++; continue; }
  console.log(`  ✓ ${tool.name}: 形状契约通过 (timeoutMs=${tool.timeoutMs})`);

  try {
    const value = await tool.execute({}, {});
    const rendered = tool.output.render({}, value);
    const renderOk = Array.isArray(rendered) && rendered.length > 0 && rendered[0].type === 'text' && typeof rendered[0].text === 'string';
    console.log(`    execute ok → render: "${rendered[0]?.text}"${renderOk ? ' ✓' : ' ✗(render 形状异常)'}`);
    if (!renderOk) failures++;
    // 关键字段健全性
    if (tool.name === 'studier_review_pool') {
      const c = value.counts || {};
      console.log(`    pool=${c.pool ?? '?'} (错题 ${c.wrong_answers ?? '?'}/节点 ${c.tree_nodes ?? '?'}), scanned=${JSON.stringify(value.scanned)}, excluded=${JSON.stringify(value.excluded)}`);
      if (!Array.isArray(value.pool)) { console.log('    ✗ pool 不是数组'); failures++; }
    }
    if (tool.name === 'studier_tree_status') {
      const t = value.totals || {};
      console.log(`    nodes=${t.nodes ?? '?'}, by_status=${JSON.stringify(t.by_status)}, unverified=${value.unverified_ai.length}, dangling=${value.dangling.total}, kp_broken=${value.kp_broken.length}`);
    }
    if (tool.name === 'studier_intake_check') {
      console.log(`    files=${value.files_scanned}, overall_ok=${value.overall_ok}, pending=${value.pending_rows_total}`);
      for (const r of value.results || []) console.log(`      ${path.basename(r.file)}: ${r.ok ? 'ok' : 'issues=' + r.issues.length}, pending=[${r.pending_rows.join(',')}]`);
    }
    if (tool.name === 'studier_schedule') {
      const c = value.counts || {};
      console.log(`    due=${c.due_today ?? '?'} upcoming=${c.upcoming ?? '?'} later=${c.later ?? '?'} never=${c.never_reviewed ?? '?'}（扫描错题 ${c.wrong_answers_scanned ?? '?'}）`);
      const buckets = ['due_today', 'upcoming', 'later', 'never_reviewed'];
      const missing = buckets.filter((b) => !Array.isArray(value[b]));
      if (missing.length) { console.log(`    ✗ 缺桶：${missing.join(',')}（超出窗口的条目会静默消失）`); failures++; }
    }
    if (tool.name === 'studier_graph_map') {
      const c = value.counts || {};
      console.log(`    nodes=${c.nodes ?? '?'} edges=${c.edges ?? '?'} 复习队列=${c.danger ?? '?'} 未开始高频=${c.not_started ?? '?'} 未核对=${c.unverified ?? '?'} 悬空=${c.dangling ?? '?'}`);
      if (!Array.isArray(value.priority_queue) || !Array.isArray(value.not_started)) {
        console.log('    ✗ priority_queue / not_started 不是数组'); failures++;
      }
    }
  } catch (e) {
    console.log(`    ✗ execute 抛错: ${e.message}`);
    failures++;
  }
}

console.log(failures === 0 ? '\n全部通过 ✓' : `\n${failures} 项失败 ✗`);
process.exitCode = failures === 0 ? 0 : 1;
