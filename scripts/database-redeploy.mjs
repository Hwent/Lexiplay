import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv, parseArgs } from 'node:util';
import { assertEmpty, databaseIdentity, distinctDatabases, fingerprint, equalFingerprint, mergePublic, quote, sha256, PUBLIC_TABLES, tables } from './database-redeploy-core.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { Client, types } = createRequire(resolve(project, 'apps/api/package.json'))('pg');
// Keep PostgreSQL timestamp precision when exporting public rows through JSON.
types.setTypeParser(1114, value => value);
types.setTypeParser(1184, value => value);
let stage = 'configuration';
const clients = [];
const local = url => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
async function config() {
  const result = {};
  try { Object.assign(result, parseEnv(await readFile(resolve(project, '.env'), 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Invalid environment file.'); }
  return { ...result, ...process.env };
}
function connection(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`Set ${label} to a PostgreSQL URL.`); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.pathname.slice(1)) throw new Error(`Invalid ${label}.`);
  if (!local(url)) url.searchParams.set('sslmode', 'verify-full');
  return url;
}
async function connect(url) {
  const client = new Client({ connectionString: url.href, connectionTimeoutMillis: 20000 });
  clients.push(client);
  await client.connect();
  await client.query("SET TIME ZONE 'UTC'");
  const version = Number((await client.query('SHOW server_version_num')).rows[0].server_version_num);
  if (version < 170000 || version >= 180000) throw new Error('This script requires PostgreSQL 17 (source and destination).');
  return client;
}
function run(args, env = process.env) {
  return new Promise((accept, reject) => {
    const child = spawn('docker', args, { cwd: project, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', () => {});
    child.once('error', () => reject(new Error('Docker is unavailable.')));
    child.once('exit', code => code === 0 ? accept(output.trim()) : reject(new Error(`PostgreSQL Docker command failed (exit ${code}).`)));
  });
}
async function pgTool(url, folder, command, args) {
  const env = { ...process.env, PGHOST: local(url) ? 'host.docker.internal' : url.hostname,
    PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGSSLMODE: local(url) ? 'disable' : 'verify-full',
    PGSSLROOTCERT: '/etc/ssl/certs/ca-certificates.crt', PGCONNECT_TIMEOUT: '20',
    PGOPTIONS: `-c timezone=UTC${command === 'pg_dump' ? ' -c default_transaction_read_only=on' : ''}` };
  return run(['run', '--rm', ...['PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE','PGSSLROOTCERT','PGCONNECT_TIMEOUT','PGOPTIONS'].flatMap(key => ['--env', key]),
    '--mount', `type=bind,source=${folder},target=/backup`, 'postgres:17-alpine', command, ...args], env);
}
async function dump(url, folder, file, args = []) {
  await pgTool(url, folder, 'pg_dump', ['--format=custom','--no-owner','--no-acl','--lock-wait-timeout=10s', ...args, `--file=/backup/${file}`]);
}
async function restore(url, folder, file) {
  const contents = await pgTool(url, folder, 'pg_restore', ['--list', `/backup/${file}`]);
  const list = contents.split('\n').filter(line => !/^\d+; \d+ \d+ (?:SCHEMA - public|COMMENT - SCHEMA public)(?:\s|$)/.test(line)).join('\n');
  await writeFile(resolve(folder, 'restore.list'), list);
  await pgTool(url, folder, 'pg_restore', ['--dbname',decodeURIComponent(url.pathname.slice(1)),'--no-owner','--no-acl','--single-transaction','--exit-on-error','--use-list','/backup/restore.list',`/backup/${file}`]);
}
async function snapshot(client) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  return (await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
}
const stamp = () => new Date().toISOString().replace(/[-:TZ.]/g, '');
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    mode: { type: 'string' }, bundle: { type: 'string' }, 'writers-paused': { type: 'boolean' },
    apply: { type: 'boolean' }, preview: { type: 'boolean' }, help: { type: 'boolean' },
  } });
  const command = positionals[0];
  if (values.help || !command) {
    console.log('pnpm db:redeploy prepare --mode fresh\npnpm db:redeploy prepare --mode merge --writers-paused\npnpm db:redeploy publish --bundle <folder> --apply [--writers-paused]');
    return;
  }
  const env = await config();
  if (command === 'prepare') {
    const mode = values.mode;
    if (!['fresh','merge'].includes(mode)) throw new Error('Choose --mode fresh or --mode merge.');
    if (mode === 'merge' && !values['writers-paused'] && !values.preview) throw new Error('Use --preview for preparation, or pause production writers and pass --writers-paused for a publishable merge.');
    const development = connection(env.REDEPLOY_DEVELOPMENT_URL || env.DATABASE_URL, 'REDEPLOY_DEVELOPMENT_URL');
    if (!local(development)) throw new Error('Development source must be local.');
    const production = mode === 'merge' ? connection(env.REDEPLOY_PRODUCTION_URL, 'REDEPLOY_PRODUCTION_URL') : undefined;
    distinctDatabases(development.href, production?.href);
    const id = `lexiplay_redeploy_${stamp()}`;
    const folder = resolve(project, '.local-backups', id);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    stage = 'local candidate creation';
    await run(['compose','up','-d','--wait','database']);
    const candidate = new URL(`postgresql://lexiplay:lexiplay@127.0.0.1:5432/${id}`);
    distinctDatabases(development.href, production?.href, candidate.href);
    await run(['compose','exec','-T','database','createdb','-U','lexiplay',id]);
    const source = await connect(development);
    const sourceSnapshot = await snapshot(source);
    let protectedData, productionData;
    if (production) {
      stage = 'production backup';
      const live = await connect(production);
      const productionSnapshot = await snapshot(live);
      const names = await tables(live);
      protectedData = await fingerprint(live, names.filter(name => !Object.hasOwn(PUBLIC_TABLES, name)));
      productionData = await fingerprint(live);
      await dump(production, folder, 'production.dump', [`--snapshot=${productionSnapshot}`]);
      // Full backup includes schema + public + private data; separate backup eases private-data recovery.
      const privateNames = names.filter(name => !Object.hasOwn(PUBLIC_TABLES, name));
      if (privateNames.length) await dump(production, folder, 'users.dump', [`--snapshot=${productionSnapshot}`, '--data-only', ...privateNames.map(name => `--table=public.${quote(name)}`)]);
      await live.query('COMMIT');
      stage = 'production clone restore';
      await restore(candidate, folder, 'production.dump');
    } else {
      stage = 'development schema backup';
      await dump(development, folder, 'schema.dump', ['--schema-only', `--snapshot=${sourceSnapshot}`]);
      await restore(candidate, folder, 'schema.dump');
    }
    stage = 'public vocabulary merge';
    const built = await connect(candidate);
    if (productionData && !equalFingerprint(productionData, await fingerprint(built))) throw new Error('Production clone verification failed.');
    const report = await mergePublic(source, built, { fresh: mode === 'fresh' });
    await source.query('COMMIT');
    stage = 'candidate packaging';
    const candidateData = await fingerprint(built);
    await dump(candidate, folder, 'candidate.dump');
    const files = {};
    for (const file of mode === 'merge' ? ['production.dump', ...(protectedData && Object.keys(protectedData).length ? ['users.dump'] : []), 'candidate.dump'] : ['schema.dump','candidate.dump']) files[file] = sha256(await readFile(resolve(folder,file)));
    const manifest = { format: 1, id, mode, preview: Boolean(values.preview), createdAt: new Date().toISOString(), productionIdentity: production ? databaseIdentity(production.href) : null, protectedData, productionData, candidateData, files, mergedRows: report };
    const manifestText = JSON.stringify(manifest, null, 2);
    await writeFile(resolve(folder,'manifest.json'), manifestText, { mode: 0o600 });
    await writeFile(resolve(folder,'manifest.sha256'), sha256(manifestText));
    console.log(`Prepared ${mode}${values.preview ? ' preview' : ''}: ${folder}\nCandidate: ${id}\n${values.preview ? 'Preview only. Pause writers and prepare a new bundle before publishing.' : `Publish: pnpm db:redeploy publish --bundle .local-backups/${id} --apply${mode === 'merge' ? ' --writers-paused' : ''}`}`);
  } else if (command === 'publish') {
    if (!values.bundle) throw new Error('Pass --bundle <prepared folder>.');
    const folder = resolve(project, values.bundle);
    stage = 'bundle verification';
    const manifestText = await readFile(resolve(folder,'manifest.json'), 'utf8');
    if (sha256(manifestText) !== (await readFile(resolve(folder,'manifest.sha256'),'utf8')).trim()) throw new Error('Manifest checksum mismatch.');
    const manifest = JSON.parse(manifestText);
    if (manifest.format !== 1 || !['fresh','merge'].includes(manifest.mode)) throw new Error('Unsupported bundle.');
    if (manifest.preview) throw new Error('Preview bundle cannot be published. Pause writers and prepare a new merge bundle.');
    for (const [file, hash] of Object.entries(manifest.files)) {
      if (!['production.dump','users.dump','schema.dump','candidate.dump'].includes(file)) throw new Error('Invalid bundle filename.');
      if (sha256(await readFile(resolve(folder,file))) !== hash) throw new Error('Bundle checksum mismatch.');
    }
    if (!manifest.files['candidate.dump']) throw new Error('Missing candidate dump.');
    const target = connection(env.REDEPLOY_TARGET_URL, 'REDEPLOY_TARGET_URL');
    const development = connection(env.REDEPLOY_DEVELOPMENT_URL || env.DATABASE_URL, 'REDEPLOY_DEVELOPMENT_URL');
    distinctDatabases(target.href, development.href);
    if (databaseIdentity(target.href) === manifest.productionIdentity) throw new Error('Publish requires a NEW empty target, not the existing production database.');
    if (manifest.mode === 'merge') {
      if (!values['writers-paused']) throw new Error('Production writers must remain paused until cutover. Pass --writers-paused.');
      const production = connection(env.REDEPLOY_PRODUCTION_URL, 'REDEPLOY_PRODUCTION_URL');
      if (databaseIdentity(production.href) !== manifest.productionIdentity) throw new Error('Production source does not match the backup.');
      stage = 'production drift check';
      const live = await connect(production);
      await snapshot(live);
      if (!equalFingerprint(manifest.productionData, await fingerprint(live))) throw new Error('Production changed since backup. Prepare a new merge bundle.');
      await live.query('COMMIT');
    }
    stage = 'destination emptiness check';
    const destination = await connect(target);
    await assertEmpty(destination);
    if (!values.apply) { console.log('Verified bundle and empty target. Add --apply to restore.'); return; }
    // No --clean, DROP or TRUNCATE. Keep the old production database for rollback.
    const backupFolder = resolve(folder, `publish_${stamp()}`);
    await mkdir(backupFolder, { recursive: true, mode: 0o700 });
    stage = 'destination backup';
    await dump(target, backupFolder, 'target-before.dump');
    stage = 'candidate restore';
    await restore(target, folder, 'candidate.dump');
    stage = 'destination verification';
    if (!equalFingerprint(manifest.candidateData, await fingerprint(destination))) throw new Error('Restored data verification failed. Do not switch DATABASE_URL.');
    await writeFile(resolve(backupFolder,'verified.json'), JSON.stringify({ id: manifest.id, targetIdentity: databaseIdentity(target.href), verifiedAt: new Date().toISOString(), verified: true }, null, 2));
    console.log('Restore verified. Switch the service DATABASE_URL to REDEPLOY_TARGET_URL, deploy matching code, smoke-test login/library/game, then resume writers. Rollback: restore the old DATABASE_URL before reopening writes.');
  } else throw new Error('Use prepare or publish.');
}
main().catch(error => {
  // pg errors can contain private row values and URLs; print only our controlled messages.
  const safe = error?.constructor === Error && !error.code ? error.message : 'Connection, SQL or file operation failed; check configuration and schema compatibility.';
  console.error(`Stopped during ${stage}: ${safe}`);
  process.exitCode = 1;
}).finally(async () => { await Promise.allSettled(clients.map(client => client.end())); });
