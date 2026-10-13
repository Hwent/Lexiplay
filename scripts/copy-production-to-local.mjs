import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { Pool } = createRequire(resolve(project, 'apps/api/package.json'))('pg');
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '');
const name = `lexiplay_dev_${stamp}`;
const folder = resolve(project, '.local-backups', name);
const transientTables = new Set(['account_sessions', 'account_actions']);
let stage = 'configuration';

function run(args, env = process.env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn('docker', args, { cwd: project, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    // Do not print connection strings or restored personal data in tool errors.
    child.stderr.on('data', () => {});
    child.once('error', () => reject(new Error('Docker could not be started.')));
    child.once('exit', code => code === 0 ? resolveRun(output.trim()) : reject(new Error(`Docker command failed during ${stage} (exit ${code}).`)));
  });
}

async function main() {
  const source = new URL(process.env.SEED_DATABASE_URL ?? '');
  if (!['postgres:', 'postgresql:'].includes(source.protocol) || ['localhost', '127.0.0.1', '[::1]'].includes(source.hostname)) {
    throw new Error('Use the production external PostgreSQL URL in .env.deploy.');
  }
  source.searchParams.set('sslmode', 'verify-full');
  const pool = new Pool({ connectionString: source.href, connectionTimeoutMillis: 20000, max: 1 });
  const quote = value => `"${value.replaceAll('"', '""')}"`;
  let expected;
  try {
    stage = 'read-only production snapshot';
    await pool.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = (await pool.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
    const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).rows;
    expected = {};
    for (const { tablename } of tables) {
      expected[tablename] = transientTables.has(tablename) ? 0 : Number((await pool.query(`SELECT count(*) AS count FROM public.${quote(tablename)}`)).rows[0].count);
    }
    if (!expected.dictionary_words) throw new Error('Production snapshot does not contain a populated dictionary.');
    await mkdir(folder, { recursive: true });
    const dumpEnv = {
      ...process.env, PGHOST: source.hostname, PGPORT: source.port || '5432',
      PGUSER: decodeURIComponent(source.username), PGPASSWORD: decodeURIComponent(source.password),
      PGDATABASE: decodeURIComponent(source.pathname.slice(1)), PGSSLMODE: 'verify-full',
      PGSSLROOTCERT: '/etc/ssl/certs/ca-certificates.crt', PGCONNECT_TIMEOUT: '20',
      PGOPTIONS: '-c default_transaction_read_only=on',
    };
    await run(['run', '--rm', ...['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGSSLMODE', 'PGSSLROOTCERT', 'PGCONNECT_TIMEOUT', 'PGOPTIONS'].flatMap(key => ['--env', key]),
      '--mount', `type=bind,source=${folder},target=/backup`, 'postgres:17-alpine',
      'pg_dump', '--format=custom', '--schema=public', '--no-owner', '--no-acl', '--lock-wait-timeout=10s',
      `--snapshot=${snapshot}`, ...[...transientTables].map(table => `--exclude-table-data=public.${table}`), '--file=/backup/production.dump'], dumpEnv);
    await pool.query('COMMIT');
  } finally { await pool.end(); }

  stage = 'local database startup';
  await run(['compose', 'up', '-d', '--wait', 'database']);
  const container = await run(['compose', 'ps', '-q', 'database']);
  if (!container || /\s/.test(container)) throw new Error('Expected exactly one local database container.');
  stage = 'new local database creation';
  await run(['compose', 'exec', '-T', 'database', 'createdb', '-U', 'lexiplay', name]);
  await run(['cp', resolve(folder, 'production.dump'), `${container}:/tmp/${name}.dump`]);
  stage = 'local restore';
  // Managed PostgreSQL can explicitly dump public; createdb already supplies it.
  const contents = await run(['compose', 'exec', '-T', 'database', 'pg_restore', '--list', `/tmp/${name}.dump`]);
  const restoreList = contents.split('\n').filter(line => !/^\d+; \d+ \d+ (?:SCHEMA - public|COMMENT - SCHEMA public)(?:\s|$)/.test(line)).join('\n');
  await writeFile(resolve(folder, 'restore.list'), restoreList);
  await run(['cp', resolve(folder, 'restore.list'), `${container}:/tmp/${name}.list`]);
  await run(['compose', 'exec', '-T', 'database', 'pg_restore', '-U', 'lexiplay', '--dbname', name,
    '--no-owner', '--no-acl', '--single-transaction', '--exit-on-error', '--use-list', `/tmp/${name}.list`, `/tmp/${name}.dump`]);
  stage = 'local snapshot verification';
  const counts = {};
  for (const table of Object.keys(expected)) {
    counts[table] = Number(await run(['compose', 'exec', '-T', 'database', 'psql', '-U', 'lexiplay', '-d', name, '-At', '-c', `SELECT count(*) FROM public.${quote(table)}`]));
    if (counts[table] !== expected[table]) throw new Error(`Row-count verification failed for ${table}.`);
  }
  stage = 'local environment configuration';
  const envPath = resolve(project, '.env');
  let localEnv;
  try { localEnv = await readFile(envPath, 'utf8'); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    localEnv = await readFile(resolve(project, '.env.example'), 'utf8');
  }
  // Preserve the prior private configuration for recovery without printing it.
  await writeFile(resolve(folder, 'previous.env'), localEnv, { mode: 0o600 });
  const updates = { NODE_ENV: 'development', DATABASE_URL: `postgresql://lexiplay:lexiplay@127.0.0.1:5432/${name}`,
    HOST: '127.0.0.1', SERVE_WEB: 'false', MAIL_MODE: 'local', RESEND_API_KEY: '', PUBLIC_WEB_ORIGIN: '', RENDER_EXTERNAL_URL: '' };
  for (const [key, value] of Object.entries(updates)) {
    const pattern = new RegExp(`^${key}=.*$`, 'gm');
    localEnv = pattern.test(localEnv) ? localEnv.replace(pattern, `${key}=${value}`) : `${localEnv.trimEnd()}\n${key}=${value}\n`;
  }
  await writeFile(envPath, localEnv, { mode: 0o600 });
  await writeFile(resolve(folder, 'verification.json'), JSON.stringify({ database: name, copiedAt: new Date().toISOString(),
    schema: 'public', omittedSessionAndActionData: [...transientTables], counts, verified: true }, null, 2));
  console.log(JSON.stringify({ localDatabase: name, verifiedTables: Object.keys(counts).length, counts, configuredLocalEnv: true }, null, 2));
}

main().catch(() => {
  console.error(`Database copy stopped during ${stage}. Production was only read; existing local databases were preserved. Check Docker, external database access, TLS, and PostgreSQL version compatibility. No credentials are printed.`);
  process.exitCode = 1;
});
