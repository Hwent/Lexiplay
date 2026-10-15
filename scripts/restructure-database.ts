import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createGzip } from 'node:zlib';
import { parseArgs, parseEnv } from 'node:util';
import { Client, Pool } from '../apps/api/node_modules/pg';
import { publishDictionary, type LibraryWord } from '../apps/api/src/modules/word-lists/library-maintenance';
import { backupDatabase, connectWorktree, localDatabase, run, verifyDictionary } from './database-maintenance';

const root = resolve(__dirname, '..');
async function main() {
  const { values } = parseArgs({ options: {
    'source-env': { type: 'string' }, 'target-name': { type: 'string' },
    'expected-words': { type: 'string' }, connect: { type: 'boolean' },
  } });
  if (!values['source-env'] || !values['target-name'] || !values['expected-words']) {
    throw new Error('Use --source-env <local .env> --target-name lexiplay_clean_<name> --expected-words <count> [--connect].');
  }
  const configured = parseEnv(await readFile(resolve(values['source-env']), 'utf8'));
  const source = localDatabase(configured.DATABASE_URL ?? '');
  const name = values['target-name'];
  if (!/^lexiplay_(?:clean|test)_[a-z0-9_]+$/.test(name)) throw new Error('Use a new lexiplay_clean_* or lexiplay_test_* destination name.');
  const target = new URL(source);
  target.pathname = '/' + name;
  if (source.pathname === target.pathname) throw new Error('Source and destination must differ.');
  const client = new Client({ connectionString: source.href });
  const folder = resolve(root, '.local-backups', name);
  await mkdir(folder, { recursive: true });
  let pool: Pool | undefined;
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const count = Number((await client.query('SELECT count(*) AS count FROM dictionary_words')).rows[0].count);
    if (count !== Number(values['expected-words'])) throw new Error(`Selected source has ${count} dictionary words, not the expected ${values['expected-words']}.`);
    if ((await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount) throw new Error('Destination already exists; choose a new name.');
    const snapshot = (await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
    console.log('Backing up the complete selected source database...');
    await backupDatabase(source, folder, snapshot);
    const words = (await client.query<{ data: LibraryWord }>('SELECT to_jsonb(w) AS data FROM dictionary_words w ORDER BY term COLLATE "C"')).rows.map(row => row.data);
    await pipeline(Readable.from(words.map(word => JSON.stringify(word) + '\n')), createGzip(), createWriteStream(resolve(folder, 'dictionary.jsonl.gz'), { flags: 'wx' }));
    await client.query('COMMIT');
    await client.query('CREATE DATABASE "' + name + '"');
    console.log('Applying Prisma migrations to the empty replacement...');
    const prisma = resolve(root, 'apps/api/node_modules/prisma/build/index.js');
    console.log(await run(process.execPath, [prisma, 'migrate', 'deploy', '--config', resolve(root, 'apps/api/prisma.config.ts')], { ...process.env, DATABASE_URL: target.href }));
    pool = new Pool({ connectionString: target.href });
    console.log('Normalizing and verifying the selected dictionary...');
    const imported = await publishDictionary(pool, words, source.pathname.slice(1));
    const verified = await verifyDictionary(pool, words);
    if (verified.accounts || verified.personalWords || verified.games) throw new Error('Test data remains in the replacement.');
    const report = { targetDatabase: name, sourceDatabase: source.pathname.slice(1), ...imported, ...verified };
    await writeFile(resolve(folder, 'verification.json'), JSON.stringify(report, null, 2));
    if (values.connect) {
      await connectWorktree(target);
    }
    console.log(JSON.stringify(report, null, 2));
    console.log('Recovery files: ' + folder);
  } finally { await pool?.end(); await client.end(); }
}
void main().catch(error => { console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[database URL]') : 'Database preparation failed.'); process.exitCode = 1; });
