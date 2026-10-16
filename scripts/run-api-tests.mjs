import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const api = resolve(project, 'apps/api');
const require = createRequire(resolve(api, 'package.json'));
const { Client } = require('pg');
const { values } = parseArgs({ options: { 'source-env': { type: 'string' } } });
let configured = {};
try { configured = parseEnv(await readFile(values['source-env'] ?? resolve(project, '.env'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const source = new URL(process.env.DATABASE_URL ?? configured.DATABASE_URL ?? 'postgresql://lexiplay:lexiplay@127.0.0.1:5432/lexiplay');
const target = new URL(process.env.TEST_DATABASE_URL ?? source.href);
if (!process.env.TEST_DATABASE_URL) target.pathname = '/lexiplay_test_canonical_' + createHash('sha256').update(project).digest('hex').slice(0, 8);
for (const database of [source, target]) {
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !['127.0.0.1','localhost','[::1]'].includes(database.hostname)) throw new Error('API tests require local PostgreSQL.');
}
const name = decodeURIComponent(target.pathname.slice(1));
if (!/^lexiplay_test_[a-z0-9_]+$/.test(name) || target.pathname === source.pathname && !process.env.TEST_DATABASE_URL) throw new Error('A separate lexiplay_test_* database is required.');
if (!process.env.TEST_DATABASE_URL) {
  const admin = new Client({ connectionString: source.href });
  try {
    await admin.connect();
    if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount) await admin.query('CREATE DATABASE "' + name + '"');
  } finally { await admin.end(); }
}
const env = { ...process.env, DATABASE_URL: target.href, TEST_DATABASE_URL: target.href, NODE_ENV: 'test', MAIL_MODE: 'local' };
function run(entry, args) {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, [entry, ...args], { cwd: api, env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? accept() : reject(new Error('API check failed: ' + code)));
  });
}
const prisma = resolve(dirname(require.resolve('prisma/package.json')), 'build/index.js');
await run(prisma, ['generate']);
await run(prisma, ['migrate','deploy']);
await run(resolve(dirname(require.resolve('vitest/package.json')), 'vitest.mjs'), ['run','--exclude','dist/**','--maxWorkers=1']);
