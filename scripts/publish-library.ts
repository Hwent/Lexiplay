import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { parseArgs, parseEnv } from 'node:util';
import { Pool } from '../apps/api/node_modules/pg';
import { publishDictionary, type LibraryWord } from '../apps/api/src/modules/word-lists/library-maintenance';
import { backupDatabase, connectWorktree, localDatabase, verifyDictionary } from './database-maintenance';

async function main() {
  const { values } = parseArgs({ options: {
    'database-env': { type: 'string', default: '.env' }, dictionary: { type: 'string' },
    'expected-words': { type: 'string' }, 'writers-paused': { type: 'boolean' }, connect: { type: 'boolean' },
  } });
  if (!values.dictionary || !values['expected-words'] || !values['writers-paused']) {
    throw new Error('Stop the API, then use --dictionary <dictionary.jsonl.gz> --expected-words <count> --writers-paused [--database-env <.env>] [--connect].');
  }
  const configured = parseEnv(await readFile(resolve(values['database-env']), 'utf8'));
  const database = localDatabase(configured.DATABASE_URL ?? '');
  const words: LibraryWord[] = [];
  const lines = createInterface({ input: createReadStream(resolve(values.dictionary)).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of lines) if (line.trim()) words.push(JSON.parse(line));
  if (words.length !== Number(values['expected-words'])) throw new Error('Dictionary file count differs from --expected-words.');
  const folder = resolve(__dirname, '..', '.local-backups', database.pathname.slice(1),
    'publish_' + new Date().toISOString().replace(/[-:.]/g, ''));
  await mkdir(folder, { recursive: true });
  console.log('Backing up the database before publication...');
  await backupDatabase(database, folder);
  const pool = new Pool({ connectionString: database.href });
  try {
    const imported = await publishDictionary(pool, words, resolve(values.dictionary));
    console.log('Verifying every spelling, meaning, and source metadata...');
    const verified = await verifyDictionary(pool, words);
    const report = { targetDatabase: database.pathname.slice(1), ...imported, ...verified };
    await writeFile(resolve(folder, 'verification.json'), JSON.stringify(report, null, 2));
    if (values.connect) await connectWorktree(database);
    console.log(JSON.stringify(report, null, 2));
    console.log('Recovery files: ' + folder);
  } finally { await pool.end(); }
}
void main().catch(error => {
  console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[database URL]') : 'Dictionary publication failed.');
  process.exitCode = 1;
});
