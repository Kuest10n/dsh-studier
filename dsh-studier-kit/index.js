// dsh-studier-kit —— studier 学习系统的 DSH 只读工具组
//
// 目标宿主：DSH 0.2.2-rc.x 桌面客户端（profiles/desktop）
// 契约来源：本机实跑中的 dsh-video-read（export const name / inject / apply(ctx, config) / ctx.tools.register）
//
// 设计红线（来自 E:\studier\docs\GOAL.md 与 vault/README.md）：
//   1. 只读：绝不写 vault 的任何文件；错题本「我的错因/正确思路」永远只由本人手写。
//   2. 工具做脚手架不做大脑：本插件不发明间隔、不出题、不判会；
//      排期/归类/判会决策永远交给会话内的 Agent + 本人。
//   3. 空数据优雅降级：vault 目前多为模板态，所有工具在零数据时返回结构化空结果而非报错。

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const name = 'dsh-studier-kit';

export const inject = ['tools'];

const DEFAULT_VAULT_ROOT = 'E:\\studier\\vault';

// ---------------------------------------------------------------------------
// 通用：vault 扫描（只读）
// ---------------------------------------------------------------------------

function resolveVault(config) {
  const root = (config && config.vaultRoot) || DEFAULT_VAULT_ROOT;
  return root;
}

// vault 存在性守卫：路径配错时给一句人话，而不是让 5 个工具各自抛 ENOENT 栈。
// 返回 null=可用；返回对象=不可用（调用方直接把它当结果返回，render 会打出 message）。
async function checkVault(vault) {
  try {
    const st = await stat(vault);
    if (!st.isDirectory()) {
      return {
        ok: false,
        code: 'vault_not_directory',
        vault,
        message: `vault 配置不是目录：${vault}。请改 $DSH_HOME\\cordis.patch.yml 里 notara-vault-sqlite 的 config.root。`,
      };
    }
    return null;
  } catch {
    return {
      ok: false,
      code: 'vault_missing',
      vault,
      message: `vault 目录不存在：${vault}。请检查 $DSH_HOME\\cordis.patch.yml 里 notara-vault-sqlite 的 config.root（或插件的 vaultRoot 配置）。`,
    };
  }
}

// 给工具套两层守卫：①vault 不可用时 execute 直接返回人话错误 ②render 遇到该错误不崩
function guardTool(tool, cfg) {
  const origRender = tool.output && typeof tool.output.render === 'function' ? tool.output.render : null;
  const guarded = { ...tool };
  if (tool.output) {
    guarded.output = {
      ...tool.output,
      render: (args, value) => {
        if (value && value.ok === false) return [textBlock(String(value.message || `工具无法读取 vault：${value.code || 'unknown'}`))];
        return origRender ? origRender(args, value) : [textBlock(JSON.stringify(value, null, 2))];
      },
    };
  }
  guarded.execute = async (args, exec) => {
    const bad = await checkVault(resolveVault(cfg));
    if (bad) return bad;
    return tool.execute(args, exec);
  };
  return guarded;
}

async function walkMarkdown(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out; // 目录不存在 → 空结果（模板态 vault 是常态）
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      await walkMarkdown(full, out);
    } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md') && !ent.name.startsWith('_')) {
      out.push(full);
    }
  }
  return out;
}

// 极简 frontmatter 解析器（覆盖 vault 模板用到的 YAML 子集）：
//   key: value / key: "value" / key: [a, b] / key: 后跟 "  - item" 块列表 / 布尔 / 数字
//   行内注释：剥掉空白后的 " #..."（Obsidian 标题链接 [[file#sec]] 的 # 前无空白，不受影响）
function parseFrontmatter(text) {
  const result = { data: {}, body: text, error: null };
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return result;
  result.body = text.slice(m[0].length);
  const lines = m[1].split(/\r?\n/);
  let lastKey = null;
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const blockItem = raw.match(/^\s+-\s+(.*)$/);
    if (blockItem && lastKey) {
      const arr = Array.isArray(result.data[lastKey]) ? result.data[lastKey] : [];
      arr.push(cleanScalar(blockItem[1]));
      result.data[lastKey] = arr;
      continue;
    }
    const kv = raw.match(/^([A-Za-z0-9_\-\u4e00-\u9fff]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2];
    if (val === '') { result.data[key] = null; lastKey = key; continue; }
    lastKey = key;
    if (val.startsWith('[') && val.endsWith(']')) {
      const inner = val.slice(1, -1).trim();
      result.data[key] = inner === '' ? [] : inner.split(',').map((s) => cleanScalar(s));
      continue;
    }
    result.data[key] = cleanScalar(val);
  }
  return result;
}

function cleanScalar(s) {
  let v = s.replace(/\s+#.*$/, '').trim(); // 行内注释（# 前必有空白）
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

// [[target|alias]] / [[namespace/target]] → 规范化目标名
function linkTarget(link) {
  const m = String(link).match(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/);
  if (!m) return null;
  return m[1].split('/').pop().trim();
}

function toNum(v) {
  if (v === null || v === undefined) return null;
  // 空单元格必须当「没填」而不是 0：Number('') === 0 会把实得留空的题
  // 当成得 0 分并计入分母，直接算错卷面得分率（主指标）。
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// 未核对节点（vault 纪律：ai-generated 且 needs_review=true 不进任务表/复习池/排期）
function isUnverified(node) {
  return node.needs_review === true && node.authority === 'ai-generated';
}

// ---------------------------------------------------------------------------
// 输出渲染：render 返回的文本就是模型在会话里读到的工具结果，
// 因此必须自带足以工作的细节（不能只给一行摘要），同时按条数封顶防爆上下文。
// ---------------------------------------------------------------------------
const textBlock = (t) => ({ type: 'text', text: t });

const clip = (s, n = 140) => {
  const x = String(s === null || s === undefined ? '' : s);
  return x.length > n ? `${x.slice(0, n)}…` : x;
};

const lines = (...parts) => parts.filter((p) => p !== null && p !== undefined && p !== '').join('\n');

// 条目编号列表；超出上限时明确写出「还有 N 条未列出」而不是静默截断
function numbered(items, limit, fmt) {
  const shown = items.slice(0, limit).map((it, i) => `${i + 1}. ${fmt(it)}`);
  if (items.length > limit) shown.push(`……另有 ${items.length - limit} 条未列出（用 limit 参数或缩小筛选范围再看）`);
  return shown.length ? shown.join('\n') : '（空）';
}

// 卡片三文件的就绪标签（只报存在性，不转述内容）
const cardTag = (c) => {
  if (!c) return '卡片=?';
  if (c.missing_all) return '卡片: 无（先写手写卡）';
  return `卡片: 手写${c.my ? '✓' : '✗'}/AI${c.ai ? '✓' : '✗'}/判决${c.verdict ? '✓' : '✗'}${c.ready ? '（可进比对）' : ''}`;
};

// ---------------------------------------------------------------------------
// 数据加载：错题本 / 知识树 / 指标表
// ---------------------------------------------------------------------------

async function loadWrongAnswers(vault) {
  const dir = path.join(vault, '10知识', '错题本');
  const files = await walkMarkdown(dir);
  const entries = [];
  const parseErrors = [];
  for (const f of files) {
    try {
      const text = await readFile(f, 'utf8');
      const { data } = parseFrontmatter(text);
      entries.push({
        file: f,
        题号: data['题号'] ?? null,
        date: data.date ?? null,
        subject: data.subject ?? null,
        score_full: toNum(data.score_full),
        score_got: toNum(data.score_got),
        self_state: data.self_state ?? null,
        star: data.star === true,
        kp: Array.isArray(data.kp) ? data.kp : [],
        wrong_reason: data.wrong_reason ?? null,
        review_count: toNum(data.review_count) ?? 0,
        last_review: data.last_review ?? null,
        mastered: data.mastered === true,
      });
    } catch (e) {
      parseErrors.push({ file: f, error: String(e && e.message || e) });
    }
  }
  return { entries, parseErrors, scanned: files.length };
}

async function loadTreeNodes(vault) {
  const dir = path.join(vault, '10知识', '知识树');
  const files = await walkMarkdown(dir);
  const nodes = [];
  const skipped = [];
  const parseErrors = [];
  for (const f of files) {
    try {
      const text = await readFile(f, 'utf8');
      const { data } = parseFrontmatter(text);
      if (!data.id && !data.name) {
        // 无 frontmatter 的笔记（如 索引.md）不算节点，但不能静默消失：
        // 扫描数 74 却只报 73 个节点时，人会以为工具漏读。
        skipped.push(path.basename(f));
        continue;
      }
      nodes.push({
        file: f,
        id: data.id ?? path.basename(f, '.md'),
        name: data.name ?? path.basename(f, '.md'),
        subject: data.subject ?? null,
        type: data.type ?? null,
        authority: data.authority ?? null,
        needs_review: data.needs_review === true,
        freq: data.freq ?? null,
        status: data.status ?? null,
        self_state: data.self_state ?? null,
        prereq: Array.isArray(data.prereq) ? data.prereq : [],
        source_question: Array.isArray(data.source_question) ? data.source_question : [],
      });
    } catch (e) {
      parseErrors.push({ file: f, error: String(e && e.message || e) });
    }
  }
  return { nodes, parseErrors, scanned: files.length, skipped };
}

// 卡片三文件：<kp-id>.my.md（本人手写）/ <kp-id>.ai.md（AI 写）/ <kp-id>.verdict.md（本人判）
// 工具只报「哪些文件存在」，不读正文：判会要双证据（比对通过 + 原题重做正确），
// 任何一张卡的内容都不该被工具转述，否则会把「阅读」当成「回忆」。
async function loadCards(vault) {
  const dir = path.join(vault, '10知识', '卡片');
  const files = await walkMarkdown(dir);
  const byKp = new Map();
  for (const f of files) {
    const base = path.basename(f);
    const m = base.match(/^(.*)\.(my|ai|verdict)\.md$/i);
    const kp = m ? m[1] : base.replace(/\.md$/i, '');
    const kind = m ? m[2].toLowerCase() : 'other';
    if (!byKp.has(kp)) byKp.set(kp, { kp, my: false, ai: false, verdict: false, files: [] });
    const rec = byKp.get(kp);
    if (kind !== 'other') rec[kind] = true;
    rec.files.push(base);
  }
  return { byKp, scanned: files.length };
}

// kp 双链 → 卡片键：既接受 [[数学/math-b1-01|集合]] 形式，也接受裸 id（工具内部按 id 查）
function kpIdOf(link) {
  const t = linkTarget(link);
  if (t) return t;
  const s = String(link === null || link === undefined ? '' : link).trim();
  return s ? s.split('/').pop().trim() : null;
}

// 一个考点 / 一组 kp 双链的卡片就绪度。ready = 有 my 且有 ai（可以进 B 步比对）
function cardStatus(cards, kpIds) {
  const ids = (kpIds || []).map(kpIdOf).filter(Boolean);
  if (!ids.length) return { kp: [], my: false, ai: false, verdict: false, ready: false, any: false, missing_all: true };
  let my = true, ai = true, verdict = true, any = false;
  const detail = [];
  for (const id of ids) {
    const rec = cards.byKp.get(id) || { my: false, ai: false, verdict: false };
    if (rec.my || rec.ai || rec.verdict) any = true;
    my = my && rec.my;
    ai = ai && rec.ai;
    verdict = verdict && rec.verdict;
    detail.push({ kp: id, my: rec.my, ai: rec.ai, verdict: rec.verdict });
  }
  return { kp: detail, my, ai, verdict, ready: my && ai, any, missing_all: !any };
}

const METRIC_TABLE_HEADER = ['题号', '满分', '实得', '三态', '★', '题干一句话', '知识点', '错因类型'];
// 取值域来自 vault/_模板.md 与 kp-classify 的错因三分判据；写错的字（如「半会了」「计算」）
// 会让下游复习池/归类轮默默漏掉这道题，所以这里显式校验。
const SELF_STATE_VALUES = new Set(['会', '半会', '不会']);
const WRONG_REASON_VALUES = new Set(['知识', '执行', '熟练']);

async function loadMetrics(vault) {
  const dir = path.join(vault, '50指标');
  const files = await walkMarkdown(dir);
  const results = [];
  const parseErrors = [];
  for (const f of files) {
    try {
      const text = await readFile(f, 'utf8');
      const { data, body } = parseFrontmatter(text);
      const rows = [];
      const pending = [];
      const invalidRows = [];
      let skippedRows = 0;
      for (const line of body.split(/\r?\n/)) {
        if (!line.trim().startsWith('|')) continue;
        const cells = line.split('|').slice(1, -1).map((c) => c.trim());
        if (cells.length < METRIC_TABLE_HEADER.length) {
          // 列数不足的数据行若静默丢弃，会让 Σ满分/rate 悄悄算错 → 记下来报警
          const first = cells[0] || '';
          if (first && first !== '题号' && !/^:?-{2,}:?$/.test(first)) skippedRows += 1;
          continue;
        }
        const first = cells[0];
        if (!first || first === '题号' || /^:?-{2,}:?$/.test(first)) continue; // 表头/分隔行
        const full = toNum(cells[1]);
        const got = toNum(cells[2]);
        const state = (cells[3] || '').trim() || null;
        const reason = (cells[7] || '').trim() || null;
        if (state && !SELF_STATE_VALUES.has(state)) invalidRows.push({ 题号: first, 字段: '三态', 值: state });
        if (reason && !WRONG_REASON_VALUES.has(reason)) invalidRows.push({ 题号: first, 字段: '错因类型', 值: reason });
        rows.push({ 题号: first, 满分: full, 实得: got, 三态: state, star: (cells[4] || '').includes('★'), 错因类型: reason });
        if (got === null) pending.push(first);
      }
      // 模板规则：实得留空的题，其满分不进分母
      let fullTotal = 0; let gotTotal = 0; let starRows = 0;
      for (const r of rows) {
        if (r.star) starRows += 1;
        if (r.实得 !== null && r.满分 !== null) { fullTotal += r.满分; gotTotal += r.实得; }
      }
      const rate = fullTotal > 0 ? Number((gotTotal / fullTotal).toFixed(4)) : null;
      results.push({
        file: f,
        date: data.date ?? null,
        exam: data.exam ?? null,
        subject: data.subject ?? null,
        frontmatter: {
          score_full_total: toNum(data.score_full_total),
          score_got_total: toNum(data.score_got_total),
          rate: toNum(data.rate),
          star_count: toNum(data.star_count),
        },
        computed: {
          rows: rows.length,
          score_full_total: fullTotal,
          score_got_total: gotTotal,
          rate,
          star_rows: starRows,
        },
        pending_rows: pending,
        skipped_rows: skippedRows,
        invalid_rows: invalidRows,
      });
    } catch (e) {
      parseErrors.push({ file: f, error: String(e && e.message || e) });
    }
  }
  return { results, parseErrors, scanned: files.length };
}

// ---------------------------------------------------------------------------
// 工具 1：studier_review_pool —— 复习候选池（只读投影，不排期）
// ---------------------------------------------------------------------------

const FREQ_RANK = { high: 0, medium: 1, low: 2 };

function reviewPoolTool(cfg) {
  return {
    name: 'studier_review_pool',
    description:
      '读取 studier 学习库（vault）的错题本与知识树，返回当前值得复习的候选清单：' +
      '错题（star==true 或 self_state∈{半会,不会}）+ 知识树节点（status==done 且 self_state∈{半会,不会}）。' +
      '每条候选同时报卡片三文件就绪度（<kp-id>.my.md 手写 / .ai.md AI / .verdict.md 本人判，只报文件存在性、不读正文），' +
      '可据此判断能否进入「卡比对 + 原题重做」的双证据判会流程。' +
      '只读、绝不写文件、不发明复习间隔；排序仅供会话内排程参考（freq high → 失分多 → 被依赖多）。' +
      'ai-generated 且 needs_review==true 的节点不进池（未核对不进任务表，vault 纪律）。',
    parameters: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: '可选，按科目过滤（如 数学/物理/化学）' },
        limit: { type: 'number', description: '可选，最多返回条数，默认 40' },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [textBlock(lines(
        `复习候选池 ${value.counts.pool} 项（错题 ${value.counts.wrong_answers} / 节点 ${value.counts.tree_nodes}）；` +
          `其中卡片可进比对 ${value.counts['卡片可判会']} 项、完全没卡片 ${value.counts['无卡片']} 项`,
        `扫描 错题本 ${value.scanned['错题本文件']} 个文件、知识树 ${value.scanned['知识树文件']} 个文件（${value.scanned['知识树节点']} 个节点，跳过 ${value.scanned['知识树跳过']} 个无 id/name 的 md）、卡片 ${value.scanned['卡片文件']} 个文件`,
        `排除：未核对 ai 节点 ${value.excluded.unverified_ai_nodes}、非 done 节点 ${value.excluded['非done节点']}、已掌握错题 ${value.excluded['已掌握错题']}`,
        `排序：${value.sort_rule}`,
        '',
        numbered(value.pool, 40, (p) => (p.source === '错题'
          ? `[错题] ${p.subject || '?'} ${p.date || '无日期'} ${p.题号 !== null ? `第${p.题号}题` : ''} · self_state=${p.self_state || '?'}${p.star ? ' ★' : ''}` +
            ` · 失分=${p.失分 ?? '?'} · 错因=${p.wrong_reason || '?'} · rc=${p.review_count} last_review=${p.last_review ?? 'null'}` +
            ` · kp=${p.kp.length ? p.kp.join(' ') : '（无）'} · ${p.why} · ${cardTag(p.cards)}\n   file=${p.file}`
          : `[节点] ${p.id || p.name} 「${p.name}」 ${p.subject || '?'} · self_state=${p.self_state} · freq=${p.freq || '?'}` +
            ` · 错题失分合计=${p.失分} · prereq_in=${p.prereq_in} · ${p.why} · ${cardTag(p.cards)}\n   file=${p.file}`)),
        '',
        ...value.notes.map((n) => `注：${n}`),
        value.parse_errors.length ? `解析错误 ${value.parse_errors.length} 处：${value.parse_errors.slice(0, 5).map((e) => clip(e, 80)).join(' | ')}` : '',
      ))],
    },
    timeoutMs: 30000,
    async execute(args) {
      const vault = resolveVault(cfg);
      const subject = args && args.subject ? String(args.subject) : null;
      const limit = Math.max(1, Math.min(200, toNum(args && args.limit) ?? 40));
      const [wa, tree, cards] = await Promise.all([loadWrongAnswers(vault), loadTreeNodes(vault), loadCards(vault)]);

      // prereq 入度（节点被多少其他节点依赖）
      const knownNames = new Set();
      for (const n of tree.nodes) { knownNames.add(n.id); knownNames.add(n.name); }
      const inDegree = new Map();
      for (const n of tree.nodes) {
        for (const p of n.prereq) {
          const t = linkTarget(p);
          if (t && knownNames.has(t)) inDegree.set(t, (inDegree.get(t) || 0) + 1);
        }
      }
      // 错题失分归到节点
      const lossByNode = new Map();
      for (const e of wa.entries) {
        const loss = e.score_full !== null && e.score_got !== null ? e.score_full - e.score_got : 0;
        for (const k of e.kp) {
          const t = linkTarget(k);
          if (t) lossByNode.set(t, (lossByNode.get(t) || 0) + Math.max(0, loss));
        }
      }

      const pool = [];
      for (const e of wa.entries) {
        const hit = e.star === true || e.self_state === '半会' || e.self_state === '不会';
        if (!hit) continue;
        if (subject && e.subject !== subject) continue;
        pool.push({
          source: '错题',
          file: e.file,
          题号: e.题号,
          date: e.date,
          subject: e.subject,
          self_state: e.self_state,
          star: e.star,
          wrong_reason: e.wrong_reason,
          失分: e.score_full !== null && e.score_got !== null ? e.score_full - e.score_got : null,
          kp: e.kp,
          review_count: e.review_count,
          last_review: e.last_review,
          cards: cardStatus(cards, e.kp),
          why: e.star ? '★隔周重做池' : `self_state=${e.self_state}`,
        });
      }
      for (const n of tree.nodes) {
        if (n.status !== 'done') continue;
        if (!(n.self_state === '半会' || n.self_state === '不会')) continue;
        if (isUnverified(n)) continue; // 未核对节点不进池（与说明一致）
        if (subject && n.subject !== subject) continue;
        pool.push({
          source: '节点',
          file: n.file,
          id: n.id,
          name: n.name,
          subject: n.subject,
          self_state: n.self_state,
          freq: n.freq,
          失分: lossByNode.get(n.id) || lossByNode.get(n.name) || 0,
          prereq_in: inDegree.get(n.id) || inDegree.get(n.name) || 0,
          cards: cardStatus(cards, [n.id]),
          why: `done 但 self_state=${n.self_state}`,
        });
      }
      pool.sort((a, b) =>
        (FREQ_RANK[a.freq] ?? 3) - (FREQ_RANK[b.freq] ?? 3) ||
        (b.失分 || 0) - (a.失分 || 0) ||
        (b.prereq_in || 0) - (a.prereq_in || 0) ||
        String(b.date || '').localeCompare(String(a.date || '')));

      const unverified = tree.nodes.filter((n) => isUnverified(n));
      const notDone = tree.nodes.filter((n) => n.status !== 'done').length;
      const mastered = wa.entries.filter((e) => e.mastered === true && !e.star && e.self_state === '会').length;

      return {
        vault,
        generated_at: new Date().toISOString(),
        counts: {
          pool: pool.length,
          wrong_answers: pool.filter((p) => p.source === '错题').length,
          tree_nodes: pool.filter((p) => p.source === '节点').length,
          卡片可判会: pool.filter((p) => p.cards && p.cards.ready).length,
          无卡片: pool.filter((p) => p.cards && p.cards.missing_all).length,
        },
        scanned: { 错题本文件: wa.scanned, 知识树文件: tree.scanned, 知识树节点: tree.nodes.length, 知识树跳过: (tree.skipped || []).length, 卡片文件: cards.scanned },
        pool: pool.slice(0, limit),
        excluded: { unverified_ai_nodes: unverified.length, 非done节点: notDone, 已掌握错题: mastered },
        sort_rule: 'freq(high→low) → 失分多 → prereq被引用多 → 日期新',
        notes: [
          '工具只给候选与事实（review_count/last_review），不发明间隔；排期决策交给会话 Agent 与本人（vault 纪律）。',
          '★错题只排周末隔周重做；复习池只从 status=done 的节点挑。',
          '卡片就绪只看文件是否存在（my=本人手写 / ai=AI 写 / verdict=本人判）；工具不读卡片正文，判会仍要双证据（卡比对 + 原题重做正确）。',
          unverified.length > 0 ? `有 ${unverified.length} 个 ai-generated 节点 needs_review=true，核对 frontmatter 前不进任务表。` : null,
        ].filter(Boolean),
        parse_errors: [...wa.parseErrors, ...tree.parseErrors],
      };
    },
  };
}

// ---------------------------------------------------------------------------
// 工具 2：studier_tree_status —— 知识树健康投影（只读）
// ---------------------------------------------------------------------------

function treeStatusTool(cfg) {
  return {
    name: 'studier_tree_status',
    description:
      '读取 studier 学习库的知识树（10知识/知识树），返回健康投影：总数与分布（status/self_state/freq/type/authority）、' +
      '未核对的 ai-generated 节点、悬空的 prereq/source_question 双链、错题 kp 双链指向不存在的节点等结构问题。只读、绝不写文件。',
    parameters: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: '可选，按科目过滤（如 数学/物理/化学）' },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [textBlock(lines(
        `知识树健康投影（${value.subject}）：${value.totals.nodes} 个节点；扫描 知识树 ${value.scanned['知识树文件']} 文件 / 错题本 ${value.scanned['错题本文件']} 文件`,
        value.scanned['知识树跳过'] ? `跳过 ${value.scanned['知识树跳过']} 个没有 id/name 的 md（${(value.skipped_files || []).join('、')}${value.scanned['知识树跳过'] > 10 ? ' …' : ''}）` : '',
        `status: ${JSON.stringify(value.totals.by_status)}`,
        `self_state: ${JSON.stringify(value.totals.by_self_state)}`,
        `freq: ${JSON.stringify(value.totals.by_freq)}`,
        `type: ${JSON.stringify(value.totals.by_type)}`,
        `authority: ${JSON.stringify(value.totals.by_authority)}`,
        '',
        `未核对 ai-generated 节点 ${value.unverified_ai.length} 个：${value.unverified_ai.length ? numbered(value.unverified_ai, 30, (n) => `${n.id || '?'}  file=${n.file}`) : '（无）'}`,
        `悬空双链 ${value.dangling.total} 处（prereq ${value.dangling.prereq.length} / source_question ${value.dangling.source_question.length}）：`,
        value.dangling.total ? numbered([...value.dangling.prereq.map((d) => ({ ...d, kind: 'prereq' })), ...value.dangling.source_question.map((d) => ({ ...d, kind: 'source_question' }))], 30, (d) => `${d.node || '?'} --${d.kind}--> ${d.target}`) : '（无）',
        `错题 kp 断链 ${value.kp_broken.length} 处：${value.kp_broken.length ? numbered(value.kp_broken, 30, (k) => `${k.target}${k.raw && k.raw !== k.target ? `（原文 ${k.raw}）` : ''}  ← file=${k.file}`) : '（无）'}`,
        '',
        ...value.notes.map((n) => `注：${n}`),
        value.parse_errors.length ? `解析错误 ${value.parse_errors.length} 处：${value.parse_errors.slice(0, 5).map((e) => clip(e, 80)).join(' | ')}` : '',
      ))],
    },
    timeoutMs: 30000,
    async execute(args) {
      const vault = resolveVault(cfg);
      const subject = args && args.subject ? String(args.subject) : null;
      const [tree, wa] = await Promise.all([loadTreeNodes(vault), loadWrongAnswers(vault)]);
      let nodes = tree.nodes;
      if (subject) nodes = nodes.filter((n) => n.subject === subject);

      const known = new Set();
      for (const n of tree.nodes) { known.add(n.id); known.add(n.name); }

      const tally = (key) => {
        const out = {};
        for (const n of nodes) { const k = String(n[key] ?? 'unknown'); out[k] = (out[k] || 0) + 1; }
        return out;
      };
      const danglingPrereq = []; const danglingSq = [];
      for (const n of nodes) {
        // target 存规范化后的目标名（可与节点 id/name 直接比对），raw 保留原文便于回填双链
        for (const p of n.prereq) { const t = linkTarget(p); if (t && !known.has(t)) danglingPrereq.push({ node: n.id, target: t, raw: p }); }
        for (const q of n.source_question) { const t = linkTarget(q); if (q && !known.has(t)) danglingSq.push({ node: n.id, target: t, raw: q }); }
      }
      const kpBroken = [];
      for (const e of wa.entries) {
        if (subject && e.subject !== subject) continue;
        for (const k of e.kp) { const t = linkTarget(k); if (t && !known.has(t)) kpBroken.push({ file: e.file, target: t, raw: k }); }
      }
      const unverified = nodes.filter((n) => isUnverified(n));

      return {
        vault,
        subject: subject || '全部',
        scanned: { 知识树文件: tree.scanned, 错题本文件: wa.scanned, 知识树跳过: (tree.skipped || []).length },
        totals: { nodes: nodes.length, by_status: tally('status'), by_self_state: tally('self_state'), by_freq: tally('freq'), by_type: tally('type'), by_authority: tally('authority') },
        skipped_files: (tree.skipped || []).slice(0, 10),
        unverified_ai: unverified.map((n) => ({ id: n.id, file: n.file })),
        dangling: { prereq: danglingPrereq.slice(0, 30), source_question: danglingSq.slice(0, 30), total: danglingPrereq.length + danglingSq.length },
        kp_broken: kpBroken.slice(0, 30),
        notes: [
          'authority=ai-generated 且 needs_review=true 的节点：核对 frontmatter 后人工改 false，才可进任务表。',
          '节点双链目标按 id 或 name 匹配；悬空链通常是改名后未回填。',
          '「知识树跳过」= 没有 id/name frontmatter 的 md（索引、笔记页等），不计入节点数。',
        ],
        parse_errors: tree.parseErrors,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// 工具 3：studier_intake_check —— 周考卷得分表一致性校验（只读）
// ---------------------------------------------------------------------------

function intakeCheckTool(cfg) {
  return {
    name: 'studier_intake_check',
    description:
      '校验 studier 学习库 50指标/ 下的周考卷得分表：用表格逐行重算 Σ满分/Σ实得/rate/★行数，' +
      '与 frontmatter 声明值比对，列出实得留空的待核对题号。规则与 weekend-intake 提示词一致' +
      '（实得留空的题不进分母；star_count=★行数）。只读、绝不写文件、不猜分。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [textBlock(lines(
        `指标表校验：${value.files_scanned} 份，${value.overall_ok ? '全部一致 ✓' : '存在不一致'}；待核对行（实得留空）共 ${value.pending_rows_total} 行`,
        '',
        value.results.length === 0 ? '（50指标/ 下没有找到得分表文件：系统可能仍在模板态）' : numbered(value.results, 20, (r) => {
          const fm = r.frontmatter || {};
          const head = `${r.file} ${r.ok ? '✓' : '✗'} · ${r.date || '无日期'} ${r.exam || ''} ${r.subject || ''} · ` +
            `声明 满分${fm.score_full_total ?? '空'}/实得${fm.score_got_total ?? '空'}/rate=${fm.rate ?? '空'}/★${fm.star_count ?? '空'}` +
            ` · 表算 满分${r.computed.score_full_total}/实得${r.computed.score_got_total}/rate=${r.computed.rate ?? '空'}/★${r.computed.star_rows}（${r.computed.rows} 行${r.skipped_rows ? `，另有 ${r.skipped_rows} 行列数不足未计入` : ''}）`;
          const issues = r.issues.length ? `\n   不一致：${r.issues.join('；')}` : '';
          const pend = r.pending_rows.length ? `\n   实得留空待核对：${r.pending_rows.slice(0, 20).join('、')}${r.pending_rows.length > 20 ? ' …' : ''}` : '';
          return head + issues + pend;
        }),
        '',
        ...value.notes.map((n) => `注：${n}`),
        value.parse_errors.length ? `解析错误 ${value.parse_errors.length} 处：${value.parse_errors.slice(0, 5).map((e) => clip(e, 80)).join(' | ')}` : '',
      ))],
    },
    timeoutMs: 30000,
    async execute() {
      const vault = resolveVault(cfg);
      const { results, parseErrors, scanned } = await loadMetrics(vault);
      let pendingTotal = 0; let overallOk = true;
      const out = results.map((r) => {
        const fm = r.frontmatter; const c = r.computed;
        const issues = [];
        const check = (label, declared, computed) => {
          if (declared === null || declared === undefined) { issues.push(`${label}: frontmatter 未填（表算得 ${computed}）`); return; }
          if (Number(declared) !== Number(computed)) issues.push(`${label}: frontmatter=${declared} 但表格重算=${computed}`);
        };
        check('score_full_total', fm.score_full_total, c.score_full_total);
        check('score_got_total', fm.score_got_total, c.score_got_total);
        if (fm.rate !== null && c.rate !== null && Math.abs(Number(fm.rate) - Number(c.rate)) > 0.005) {
          issues.push(`rate: frontmatter=${fm.rate} 但表算=${c.rate}`);
        }
        check('star_count', fm.star_count, c.star_rows);
        if (r.skipped_rows > 0) {
          issues.push(`表格有 ${r.skipped_rows} 行列数不足 8 列（少写了 | ？），这些行没有计入 Σ满分/实得/★，请对照原卷补齐`);
        }
        if (r.invalid_rows && r.invalid_rows.length) {
          const detail = r.invalid_rows.slice(0, 6).map((x) => `第${x.题号}题${x.字段}=「${x.值}」`).join('、');
          issues.push(`取值不在允许范围：${detail}${r.invalid_rows.length > 6 ? ' …' : ''}（三态只能是 会/半会/不会，错因类型只能是 知识/执行/熟练）`);
        }
        pendingTotal += r.pending_rows.length;
        const ok = issues.length === 0;
        if (!ok) overallOk = false;
        return { ...r, issues, ok };
      });
      return {
        vault,
        files_scanned: scanned,
        overall_ok: overallOk && parseErrors.length === 0,
        pending_rows_total: pendingTotal,
        results: out,
        parse_errors: parseErrors,
        notes: [
          '待核对行=实得留空的题：按 weekend-intake 纪律不猜分，留给归类轮或问本人。',
          '本工具不改文件；修数据请在 vault 源文件手工改。',
        ],
      };
    },
  };
}

// ---------------------------------------------------------------------------
// 工具 4：studier_schedule —— 动态间隔复习到期清单（只读投影，A 增量）
// ---------------------------------------------------------------------------

// 透明间隔阶梯（源自 vault 方法论的间隔节奏：当天→3天→7天→21天，扩张式；
// ★错题另有「隔周重做、只排周末」纪律）。工具给出的是"建议 due"，排期决策仍由本人确认。
function suggestedIntervalDays(entry) {
  const rc = entry.review_count || 0;
  if (entry.self_state === '不会') return 1;                     // 次日必回
  if (entry.self_state === '半会') return Math.min(3 + rc * 2, 7); // 半会逐步拉长，封顶一周
  if (entry.self_state === '会') return [7, 14, 21, 21][Math.min(rc, 3)]; // 会之后扩张式
  return 7; // 未知状态按一周兜底
}

// 解析 YYYY-MM-DD（容忍 '2025-1-3' 与 ISO 时间戳前缀）；无效返回 null
function parseDate(v) {
  if (v === null || v === undefined) return null;
  const m = String(v).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(d, n) { const x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }

// 下一个不早于 base 的周六（★隔周重做只排周末；base 距今不足 7 天则再推一周 = 隔周）
function nextSaturdayOnOrAfter(base, minGapDays) {
  let d = addDays(base, Math.max(0, minGapDays));
  while (d.getDay() !== 6) d = addDays(d, 1);
  return d;
}

function scheduleTool(cfg) {
  return {
    name: 'studier_schedule',
    description:
      '计算 studier 学习库的动态间隔复习到期清单（只读投影）：对错题本条目按 self_state×review_count 的透明阶梯' +
      '（不会=1天，半会=3→7天，会=7→14→21天，答错降级自然重置）与 ★错题隔周重做（只排周六）算出 next_due，' +
      '返回三桶：今天到期 / 未来7天 / 从未复习（无 last_review 的错题与 done 但半会不会的节点）。' +
      '只读、绝不写文件、不改 frontmatter；输出的是建议值，排期决策由会话内本人确认（脚手架不做大脑）。',
    parameters: {
      type: 'object',
      properties: {
        horizon_days: { type: 'number', description: '可选，未来窗口天数，默认 7' },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [textBlock(lines(
        `复习排期（今天 ${value.today}，窗口 ${value.horizon_days} 天）：今天到期 ${value.counts.due_today}，未来 ${value.horizon_days} 天 ${value.counts.upcoming}，窗口外更晚 ${value.counts.later}，从未复习 ${value.counts.never_reviewed}；扫描错题 ${value.counts.wrong_answers_scanned} 条`,
        `卡片就绪（只看文件存在性）：可进比对 ${value.counts['卡片可比对']} 条、完全没卡片 ${value.counts['无卡片']} 条（缺卡片的先写手写卡，再谈判会）`,
        '',
        `== 今天到期（${value.counts.due_today}）==`,
        value.due_today.length ? numbered(value.due_today, 50, (it) =>
          `[${it.source}] ${it.subject || '?'} ${it.题号 !== null ? `第${it.题号}题` : (it.file.split(/[\\/]/).pop() || '')} · self_state=${it.self_state || '?'}${it.star ? ' ★' : ''}` +
          ` · 建议间隔 ${it.suggested_interval_days} 天 → 到期 ${it.next_due} · 逾期 ${it.overdue_days} 天 · ${it.rule} · ${cardTag(it.cards)}\n   file=${it.file}`) : '（空）',
        '',
        `== 未来 ${value.horizon_days} 天（${value.counts.upcoming}）==`,
        value.upcoming.length ? numbered(value.upcoming, 30, (it) =>
          `[${it.source}] ${it.subject || '?'} ${it.题号 !== null ? `第${it.题号}题` : (it.file.split(/[\\/]/).pop() || '')} · 到期 ${it.next_due} · self_state=${it.self_state || '?'}${it.star ? ' ★' : ''} · ${it.rule} · ${cardTag(it.cards)}`) : '（空）',
        '',
        `== 窗口外更晚（${value.counts.later}）==`,
        value.later.length ? numbered(value.later, 30, (it) =>
          `[${it.source}] ${it.subject || '?'} ${it.题号 !== null ? `第${it.题号}题` : (it.file.split(/[\\/]/).pop() || '')} · 到期 ${it.next_due} · ${it.rule}`) : '（空）',
        '',
        `== 从未复习（${value.counts.never_reviewed}）==`,
        value.never_reviewed.length ? numbered(value.never_reviewed, 30, (it) =>
          `[${it.source === '节点' ? '节点' : '错题'}] ${it.subject || '?'} ${it.题号 !== null ? `第${it.题号}题` : (it.file.split(/[\\/]/).pop() || '')} · self_state=${it.self_state || '?'} · ${it.rule}${it.why ? ` · ${it.why}` : ''} · ${cardTag(it.cards)}\n   file=${it.file}`) : '（空）',
        '',
        `== 阶梯规则 ==`,
        ...Object.entries(value.ladder_rule).map(([k, v]) => `- ${k}: ${v}`),
        '',
        ...value.notes.map((n) => `注：${n}`),
        value.parse_errors.length ? `解析错误 ${value.parse_errors.length} 处：${value.parse_errors.slice(0, 5).map((e) => clip(e, 80)).join(' | ')}` : '',
      ))],
    },
    timeoutMs: 30000,
    async execute(args) {
      const vault = resolveVault(cfg);
      const horizon = Math.max(1, Math.min(60, toNum(args && args.horizon_days) ?? 7));
      const wa = await loadWrongAnswers(vault);
      const tree = await loadTreeNodes(vault);
      const cards = await loadCards(vault);

      const today = new Date(); today.setHours(0, 0, 0, 0);
      const horizonEnd = addDays(today, horizon);

      const decorate = (e, source) => {
        const base = parseDate(e.last_review) || parseDate(e.date);
        const interval = suggestedIntervalDays(e);
        let nextDue = null; let ruleNote = '';
        if (e.star) {
          nextDue = nextSaturdayOnOrAfter(base || today, 7);
          ruleNote = '★隔周重做：只排周六（与上次间隔≥7天）';
        } else if (base) {
          nextDue = addDays(base, interval);
          ruleNote = `self_state=${e.self_state} × review_count=${e.review_count} → 间隔${interval}天`;
        }
        return {
          source,
          file: e.file,
          题号: e.题号 ?? null,
          subject: e.subject,
          self_state: e.self_state,
          star: e.star === true,
          last_review: e.last_review ?? null,
          review_count: e.review_count ?? 0,
          suggested_interval_days: interval,
          next_due: nextDue ? fmtDate(nextDue) : null,
          overdue_days: nextDue ? Math.max(0, Math.round((today - nextDue) / 86400000)) : null,
          cards: cardStatus(cards, source === '节点' ? [e.id || e.name] : e.kp),
          rule: ruleNote,
        };
      };

      const dueToday = []; const upcoming = []; const neverReviewed = []; const later = [];
      for (const e of wa.entries) {
        if (e.mastered && !e.star && e.self_state === '会') continue; // 已掌握退出池
        const item = decorate(e, '错题');
        if (!item.next_due) { neverReviewed.push({ ...item, why: '无 last_review/date 可算' }); continue; }
        const due = parseDate(item.next_due);
        if (due <= today) dueToday.push(item);
        else if (due <= horizonEnd) upcoming.push(item);
        else later.push(item); // 超出窗口也必须在报告里可见（★ 可能落到 +13 天）
      }
      // 知识树节点没有复习时间戳（frontmatter 无 last_review）→ 只进「从未复习」桶，不伪造日期
      for (const n of tree.nodes) {
        if (n.status !== 'done') continue;
        if (!(n.self_state === '半会' || n.self_state === '不会')) continue;
        if (isUnverified(n)) continue; // 未核对节点不排期
        neverReviewed.push({
          source: '节点', file: n.file, 题号: null, subject: n.subject, self_state: n.self_state,
          star: false, last_review: null, review_count: null, suggested_interval_days: null,
          next_due: null, overdue_days: null, id: n.id || null, name: n.name,
          cards: cardStatus(cards, [n.id || n.name]),
          rule: '节点无复习时间戳；建议在会话中与本人确认后首次排期',
        });
      }
      const byOverdue = (a, b) => (b.overdue_days || 0) - (a.overdue_days || 0);
      dueToday.sort(byOverdue);
      upcoming.sort((a, b) => String(a.next_due).localeCompare(String(b.next_due)));
      later.sort((a, b) => String(a.next_due).localeCompare(String(b.next_due)));

      return {
        vault,
        today: fmtDate(today),
        horizon_days: horizon,
        counts: {
          due_today: dueToday.length,
          upcoming: upcoming.length,
          later: later.length,
          never_reviewed: neverReviewed.length,
          wrong_answers_scanned: wa.scanned,
          卡片可比对: [...dueToday, ...upcoming, ...later, ...neverReviewed].filter((it) => it.cards && it.cards.ready).length,
          无卡片: [...dueToday, ...upcoming, ...later, ...neverReviewed].filter((it) => it.cards && it.cards.missing_all).length,
        },
        due_today: dueToday.slice(0, 50),
        upcoming: upcoming.slice(0, 50),
        later: later.slice(0, 30),
        never_reviewed: neverReviewed.slice(0, 50),
        ladder_rule: {
          不会: '1天后回', 半会: '3天起，每复习一次+2天，封顶7天', 会: '7→14→21天扩张式',
          star: '隔周重做，只排周六', 降级: 'self_state 掉档时 review_count 不清零但间隔按新状态算（数据不回写，重算即时生效）',
        },
        notes: [
          '工具输出 next_due 是按公开阶梯算的建议值；是否执行、排进哪天，由会话内本人决定（vault 纪律：每周只改1处、工具≤60min/周）。',
          '★错题只排周末；知识树节点缺复习时间戳，首排需人工确认（节点 frontmatter 无 last_review 字段是 vault 现状，不伪造日期）。',
          '本工具只读：不写 40周任务表、不改错题本 frontmatter。',
        ],
        parse_errors: wa.parseErrors,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// 工具 5：studier_graph_map —— 知识图谱双态投影（只读，B 增量）
// ---------------------------------------------------------------------------

// 双态语义（源自 Notara 方法论：显式关系优先、虚实双态）：
//   虚态 = 考纲/教材权威(authority) + 高考频次(freq) + 骨架位置(prereq 入度，被多少节点依赖)
//   实态 = 掌握进度(status/self_state) + 错题失分(错题本 kp 双链聚合)
// 投影只做「把两层事实并排摆出来」，推断与决策留给会话内本人。
// （freq 排序沿用上方 review_pool 已声明的 FREQ_RANK：high=0 medium=1 low=2）

function graphMapTool(cfg) {
  return {
    name: 'studier_graph_map',
    description:
      '输出 studier 知识树的双态图谱投影（只读）：每个节点并排虚态（authority 考纲权威、freq 高考频次、' +
      'prereq 入度=被多少后继依赖）与实态（status/self_state 掌握度、错题本 kp 双链聚合的失分），' +
      '返回 prereq 边表、悬空双链、以及按「高频×不会×失分」排序的优先复习队列。' +
      '只读、绝不写文件；投影不等于决策，排序建议由本人确认。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [textBlock(lines(
        `图谱双态投影：${value.counts.nodes} 个节点 / ${value.counts.edges} 条 prereq 边；复习队列(高频且不会/半会或有失分，仅已开始) ${value.counts.danger} 个；未开始但高频/卡住 ${value.counts.not_started} 个；未核对 ai 节点 ${value.counts.unverified} 个（不进队列）；悬空双链 ${value.counts.dangling} 条；扫描错题 ${value.counts.wrong_entries_scanned} 条`,
        `卡片（只看文件存在性）：有手写卡 ${value.counts['已有手写卡']} 个节点、手写+AI 都齐(可比对) ${value.counts['卡片可比对']} 个、完全没有卡片 ${value.counts['无卡片']} 个；扫描卡片文件 ${value.counts.cards_scanned} 个`,
        '',
        `== 优先复习队列（前 30，只含 status=learning/done）==`,
        value.priority_queue.length ? numbered(value.priority_queue, 30, (n) =>
          `${n.id || n.name}「${n.name}」 ${n.subject || '?'} · 虚态 freq=${n.freq || '?'} authority=${n.authority || '?'} prereq_in=${n.prereq_in}` +
          ` · 实态 status=${n.status || '?'} self_state=${n.self_state || '?'} 错题${n.wrong_count}条/失分${n.lost_total}\n   file=${n.file}`) : '（空：没有「高频且不会/半会」或带失分的已开始节点）',
        '',
        `== 未开始但高频/卡住（前 30，status=todo：动作是新学不是复习）==`,
        (value.not_started && value.not_started.length) ? numbered(value.not_started, 30, (n) =>
          `${n.id || n.name}「${n.name}」 ${n.subject || '?'} · freq=${n.freq || '?'} prereq_in=${n.prereq_in} · 错题${n.wrong_count}条/失分${n.lost_total}`) : '（空）',
        '',
        `== prereq 边（前 20，from=先修 → to=后继；完整边表见返回值的 edges 字段）==`,
        value.edges.length ? numbered(value.edges.slice(0, 20), 20, (e) => `${e.from} → ${e.to}`) : '（空）',
        '',
        `== 悬空双链（${value.counts.dangling}）==`,
        value.dangling.length ? numbered(value.dangling, 30, (d) => `${d.prereq ? 'prereq' : 'kp'} ${d.prereq || d.kp}  ← ${d.from}`) : '（无）',
        '',
        ...Object.entries(value.legend).map(([k, v]) => `- ${k}: ${v}`),
        '',
        ...value.notes.map((n) => `注：${n}`),
        value.parse_errors.length ? `解析错误 ${value.parse_errors.length} 处：${value.parse_errors.slice(0, 5).map((e) => clip(e, 80)).join(' | ')}` : '',
      ))],
    },
    timeoutMs: 30000,
    async execute() {
      const vault = resolveVault(cfg);
      const [tree, wa, cards] = await Promise.all([loadTreeNodes(vault), loadWrongAnswers(vault), loadCards(vault)]);

      const byKey = new Map(); // id 与 name 都可作 kp 双链的落点
      for (const n of tree.nodes) {
        if (n.id) byKey.set(String(n.id), n);
        if (n.name && !byKey.has(String(n.name))) byKey.set(String(n.name), n);
      }

      // 实态聚合：错题 → kp 双链 → wrong_count / lost_total
      const stats = new Map(); // node ref -> {wrong_count, lost_total}
      const dangling = [];
      for (const e of wa.entries) {
        const lost = Math.max(0, (e.score_full ?? 0) - (e.score_got ?? 0));
        const kps = Array.isArray(e.kp) ? e.kp : [];
        if (kps.length === 0) continue;
        for (const raw of kps) {
          const target = linkTarget(raw);
          if (!target) continue;
          const node = byKey.get(target);
          if (!node) { dangling.push({ from: e.file, kp: target, lost }); continue; }
          const s = stats.get(node) || { wrong_count: 0, lost_total: 0 };
          s.wrong_count += 1; s.lost_total += lost;
          stats.set(node, s);
        }
      }

      // 虚态聚合：prereq 入度（被依赖数）
      const inDeg = new Map();
      const edges = [];
      for (const n of tree.nodes) {
        const pres = Array.isArray(n.prereq) ? n.prereq : [];
        for (const raw of pres) {
          const target = linkTarget(raw);
          if (!target) continue;
          const dep = byKey.get(target);
          if (!dep) { dangling.push({ from: n.file, prereq: target, lost: null }); continue; }
          inDeg.set(dep, (inDeg.get(dep) || 0) + 1);
          edges.push({ from: dep.id || dep.name, to: n.id || n.name, kind: 'prereq' });
        }
      }

      const nodes = tree.nodes.map((n) => {
        const s = stats.get(n) || { wrong_count: 0, lost_total: 0 };
        const c = cards.byKp.get(String(n.id || '')) || cards.byKp.get(String(n.name || '')) || null;
        return {
          id: n.id || null, name: n.name, subject: n.subject, type: n.type || null,
          status: n.status, self_state: n.self_state,
          authority: n.authority || null, freq: n.freq || null,
          prereq_in: inDeg.get(n) || 0,
          wrong_count: s.wrong_count, lost_total: s.lost_total,
          cards: { my: !!(c && c.my), ai: !!(c && c.ai), verdict: !!(c && c.verdict) },
          file: n.file,
        };
      });

      // 优先队列：高频 → 不会/半会 → 失分多 → 被依赖多（虚态权重的实现顺序）
      // 分两层：复习队列只管「已开始」（status=learning/done）；还没学的（todo）单列，
      // 免得「该复习的」被一堆「还没碰过的」挤掉（两者动作不同：回看 vs 新学）。
      const unverifiedKeys = new Set(tree.nodes.filter(isUnverified).map((n) => n.id || n.name));
      const active = nodes.filter((n) => !unverifiedKeys.has(n.id || n.name) && n.status !== 'todo');
      const danger = active
        .filter((n) => n.self_state === '不会' || n.self_state === '半会' || (n.wrong_count > 0 && n.self_state !== '会'))
        .sort((a, b) =>
          (FREQ_RANK[a.freq] ?? 3) - (FREQ_RANK[b.freq] ?? 3) ||
          (a.self_state === '不会' ? -1 : 1) - (b.self_state === '不会' ? -1 : 1) ||
          b.lost_total - a.lost_total || b.prereq_in - a.prereq_in);
      const notStarted = nodes
        .filter((n) => !unverifiedKeys.has(n.id || n.name) && n.status === 'todo' &&
          (n.freq === 'high' || n.self_state === '不会' || n.self_state === '半会' || n.wrong_count > 0))
        .sort((a, b) =>
          (FREQ_RANK[a.freq] ?? 3) - (FREQ_RANK[b.freq] ?? 3) ||
          b.lost_total - a.lost_total || b.prereq_in - a.prereq_in);

      return {
        vault,
        counts: {
          nodes: nodes.length,
          edges: edges.length,
          wrong_entries_scanned: wa.scanned,
          danger: danger.length,
          not_started: notStarted.length,
          unverified: tree.nodes.filter(isUnverified).length,
          dangling: dangling.length,
          cards_scanned: cards.scanned,
          已有手写卡: nodes.filter((n) => n.cards.my).length,
          卡片可比对: nodes.filter((n) => n.cards.my && n.cards.ai).length,
          无卡片: nodes.filter((n) => !n.cards.my && !n.cards.ai && !n.cards.verdict).length,
        },
        priority_queue: danger.slice(0, 30),
        not_started: notStarted.slice(0, 30),
        nodes: nodes.slice(0, 200),
        edges: edges.slice(0, 400),
        dangling: dangling.slice(0, 30),
        legend: {
          虚态: 'authority(考纲/教材/ai-generated) + freq(高考频次) + prereq_in(被多少节点当作先修)',
          实态: 'status/self_state(本人掌握自评) + wrong_count/lost_total(错题本 kp 双链聚合的失分)',
          边: 'prereq：from=先修节点 → to=后继节点；悬空=指向不存在的 id/name',
        },
        notes: [
          '本工具只读：不改知识树、不改错题本；图谱/总览 UI 由 Notara graph-and-blocks 提供，本工具是给会话用的文本投影。',
          'authority=ai-generated 且 needs_review=true 的节点未核对，进入队列时请先与本人核对（vault 纪律）。',
          'priority_queue 的排序是透明规则（freq → self_state → 失分 → 入度），不是自适应算法；调整排序=改这里，保持可解释。',
        ],
        parse_errors: wa.parseErrors,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export function apply(ctx, config = {}) {
  const cfg = { vaultRoot: (config && config.vaultRoot) || DEFAULT_VAULT_ROOT };
  const registrations = [
    ctx.tools.register(guardTool(reviewPoolTool(cfg), cfg)),
    ctx.tools.register(guardTool(treeStatusTool(cfg), cfg)),
    ctx.tools.register(guardTool(intakeCheckTool(cfg), cfg)),
    ctx.tools.register(guardTool(scheduleTool(cfg), cfg)),
    ctx.tools.register(guardTool(graphMapTool(cfg), cfg)),
  ];
  return registrations;
}

export default { name, inject, apply };
