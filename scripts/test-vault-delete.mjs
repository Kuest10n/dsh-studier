// Fixture test for the vault delete RPC (backend). Runs against a temp vault, never the real one.
import { mkdtempSync, writeFileSync, existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const vaultDir = mkdtempSync(join(tmpdir(), 'vault-delete-test-'));
const root = vaultDir.replace(/\\/g, '/');

// fixtures
writeFileSync(join(vaultDir, 'keep.md'), '# Keep\n\nThis file stays.\n');
writeFileSync(join(vaultDir, 'remove-me.md'), '# Remove me\n\nBody text.\n');
mkdirSync(join(vaultDir, 'sub'));
writeFileSync(join(vaultDir, 'sub', 'nested.md'), '# Nested\n\nNested body.\n');

const indexPath = 'E:/studier/.dsh-studier-home/profiles/web/node_modules/.pnpm/@oh-my-student+plugin-vault_eba205cfa9d38a5327d500a9b114e026/node_modules/@oh-my-student/plugin-vault-sqlite/vault-indexer.js';
const { createVaultStore } = await import(pathToFileURL(indexPath).href);

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('PASS', msg); } else { fail++; console.log('FAIL', msg); } };
const throwsCode = async (fn, code, msg) => {
  try { await fn(); ok(false, msg + ' (expected throw)'); }
  catch (e) {
    const match = code instanceof RegExp ? code.test(String(e.message)) : String(e.message) === code;
    ok(match, msg + ' -> ' + e.message);
  }
};

const store = createVaultStore({ root, cachePath: ':memory:' });

// baseline: index sees 3 docs
let q = store.query({ limit: 100 });
ok(q.total === 3, 'baseline index has 3 docs (got ' + q.total + ')');
ok(existsSync(join(vaultDir, 'remove-me.md')), 'fixture file exists before delete');

// read to get real revision
const before = store.read({ path: 'remove-me.md' });
ok(typeof before.revision === 'string' && before.revision.length > 0, 'read returns revision');

// 1. revision conflict must refuse (no delete)
await throwsCode(() => store.delete({ path: 'remove-me.md', expectedRevision: 'deadbeef' }), 'vault_revision_conflict', 'wrong revision refused');
ok(existsSync(join(vaultDir, 'remove-me.md')), 'file still exists after revision conflict');

// 2. happy path: correct revision deletes file + removes from index
const res = store.delete({ path: 'remove-me.md', expectedRevision: before.revision });
ok(res.deleted === true && res.path === 'remove-me.md', 'delete returns {deleted:true}');
ok(!existsSync(join(vaultDir, 'remove-me.md')), 'file gone from disk');
q = store.query({ limit: 100 });
ok(q.total === 2, 'index now has 2 docs (got ' + q.total + ')');
ok(!q.documents.some(d => d.path === 'remove-me.md'), 'deleted doc not in index');

// 3. nested file delete
await store.delete({ path: 'sub/nested.md' });
ok(!existsSync(join(vaultDir, 'sub', 'nested.md')), 'nested file deleted');
q = store.query({ limit: 100 });
ok(q.total === 1, 'index now has 1 doc (got ' + q.total + ')');

// 4. deleting nonexistent file -> vault_not_found
await throwsCode(() => store.delete({ path: 'ghost.md' }), 'vault_not_found', 'nonexistent file refused');

// 5. path traversal rejected
await throwsCode(() => store.delete({ path: '../outside.md' }), /.*/, 'path traversal rejected');
await throwsCode(() => store.delete({ path: 'sub/../../outside.md' }), /.*/, 'nested traversal rejected');

// 6. keep.md survived
ok(existsSync(join(vaultDir, 'keep.md')), 'unrelated keep.md survived');

store.close();
console.log(`\nRESULT pass=${pass} fail=${fail}  tmp=${vaultDir}`);
process.exit(fail ? 1 : 0);
