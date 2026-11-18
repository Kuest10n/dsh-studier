import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = 'E:/studier/.dsh-studier-home/profiles/web/node_modules/.pnpm';
const found = [];
function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const f = join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (e.name === 'client.js' && f.includes('plugin-vault-views')) found.push(f);
  }
}
import { readdirSync } from 'node:fs';
walk(root);

const NEED_WS = 'expectedRevision: doc2.revision, workspaceId';
const OLD_NO_WS = 'expectedRevision: doc2.revision }); done++';
const DELETE_CALL = 'callVault(remote, "delete"';
const FAILURES = 'const failures = []';

for (const f of found) {
  const t = readFileSync(f, 'utf8');
  const tag = (f.match(/plugin-vault_[a-z0-9]+/) || ['?'])[0];
  console.log(
    tag,
    'size=' + t.length,
    'workspaceId=' + t.includes(NEED_WS),
    'oldNoWs=' + t.includes(OLD_NO_WS),
    'deleteCall=' + t.includes(DELETE_CALL),
    'failuresVar=' + t.includes(FAILURES),
    'inode=' + statSync(f).ino
  );
}
console.log('total client.js:', found.length);
