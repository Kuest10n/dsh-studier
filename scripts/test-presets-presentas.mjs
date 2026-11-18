#!/usr/bin/env node
// 单元验证：修后的 Notara presets/policy.js 在 dsh 0.2.2-rc.1（ctx.tools 无 presentAs）
// 下创建教学子会话不再抛错；同时验证 rc.4（有 presentAs）分支仍会调用。
// 对照组 = 补丁前的 .orig 备份，必须重现 `ctx.tools.presentAs is not a function`。
//
// 做法：把 policy.js 的两个 import 替换成内存桩，写入临时 .mjs 再 import，
// 这样测的是真实补丁后的函数体，而不是重写一份逻辑。
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
  if (/^import /m.test(t)) throw new Error('unreplaced import remains:\n' + t.split('\n').filter(l => l.startsWith('import ')).join('\n'));
  writeFileSync(file, t, 'utf8');
}

function makeCtx(withPresentAs, log) {
  const agent = { ctx: null, session: { snapshotEvents: () => [] } };
  const tools = {
    get: () => ({}),                                   // 让 available 非空
    restrict: (a) => { log.push('restrict'); return () => {}; },
    guard: (f) => { log.push('guard'); return () => {}; },
  };
  if (withPresentAs) tools.presentAs = (m) => { log.push('presentAs:' + m); return () => {}; };
  const ctx = {
    tools,
    get: (k) => k === 'agentPresets' ? { composedPreset: () => 'notara-teacher' } : undefined,
    agents: { list: () => [agent], roots: () => [agent] },
    on: () => {},
    effect: () => {},
  };
  agent.ctx = ctx;
  return ctx;
}

async function run(label, source, withPresentAs) {
  const dir = mkdtempSync(join(tmpdir(), 'presas-test-'));
  const file = join(dir, 'policy.mjs');
  materialize(source, file);
  const log = [];
  let thrown = null;
  try {
    const mod = await import(pathToFileURL(file).href + '?v=' + createHash('sha1').update(label).digest('hex').slice(0, 6));
    const ctx = makeCtx(withPresentAs, log);
    mod.apply(ctx, { preset: 'notara-teacher' });
  } catch (e) { thrown = e; }
  rmSync(dir, { recursive: true, force: true });
  return { label, thrown, log };
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  PASS  ' + name); pass++; }
  else { console.log('  FAIL  ' + name + (detail ? ' :: ' + detail : '')); fail++; }
}

const control = await run('orig/no-presentAs', ORIG, false);
const p22 = await run('patched/no-presentAs', PATCHED, false);
const prc4 = await run('patched/with-presentAs', PATCHED, true);

console.log('[test-presentas] 三组对比');
// 对照组：旧代码 + 0.2.2 运行时必须重现原错误
check('对照组复现 presentAs is not a function',
  control.thrown && /presentAs is not a function/.test(control.thrown.message),
  control.thrown ? control.thrown.message : '(未抛错)');
// 0.2.2：不抛错、不调用 presentAs、restrict/guard 仍生效
check('0.2.2 运行时不抛错', !p22.thrown, p22.thrown && p22.thrown.message);
check('0.2.2 跳过 presentAs', !p22.log.some(x => x.startsWith('presentAs')));
check('0.2.2 仍执行 restrict', p22.log.includes('restrict'));
check('0.2.2 仍执行 guard', p22.log.includes('guard'));
// rc.4：有 presentAs 时仍按原行为调用
check('rc.4 不抛错', !prc4.thrown, prc4.thrown && prc4.thrown.message);
check('rc.4 仍调用 presentAs(native)', prc4.log.includes('presentAs:native'));
check('rc.4 仍执行 restrict/guard', prc4.log.includes('restrict') && prc4.log.includes('guard'));

console.log('[test-presentas] ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
