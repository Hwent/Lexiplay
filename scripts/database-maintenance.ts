import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { Pool } from '../apps/api/node_modules/pg';
import type { LibraryWord } from '../apps/api/src/modules/word-lists/library-maintenance';

export function run(command: string, args: string[], env = process.env) {
  return new Promise<string>((accept, reject) => {
    const child = spawn(command, args, { cwd: resolve(__dirname, '..'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? accept(stdout) : reject(new Error(`${command} failed (${code}): ${stderr.replace(/postgres(?:ql)?:\/\/\S+/g, '[database URL]')}`)));
  });
}

export function localDatabase(connection: string) {
  const database = new URL(connection);
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname)) {
    throw new Error('This maintenance command requires local PostgreSQL.');
  }
  return database;
}

export function postgresTool(database: URL, folder: string, args: string[]) {
  const env = { ...process.env, PGHOST: 'host.docker.internal', PGPORT: database.port || '5432',
    PGUSER: decodeURIComponent(database.username), PGPASSWORD: decodeURIComponent(database.password),
    PGDATABASE: decodeURIComponent(database.pathname.slice(1)), PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '20' };
  return run('docker', ['run', '--rm', '--pull=never',
    ...['PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE','PGCONNECT_TIMEOUT'].flatMap(key => ['--env', key]),
    '--mount', `type=bind,source=${folder},target=/backup`, 'postgres:17-alpine', ...args], env);
}

export async function backupDatabase(database: URL, folder: string, snapshot?: string) {
  await postgresTool(database, folder, ['pg_dump', '--format=custom', '--no-owner', '--no-acl',
    ...(snapshot ? ['--snapshot=' + snapshot] : []), '--file=/backup/source.dump']);
  const contents = await postgresTool(database, folder, ['pg_restore', '--list', '/backup/source.dump']);
  if ((!contents.includes('dictionary_words') && !contents.includes('dictionary_entries')) || !contents.includes('account_users')) throw new Error('Recovery backup is missing required tables.');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(resolve(folder, 'source.dump'))) hash.update(chunk);
  const manifest = { sourceDatabase: database.pathname.slice(1), snapshot, backupSha256: hash.digest('hex'), createdAt: new Date().toISOString() };
  await writeFile(resolve(folder, 'backup.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

export async function verifyDictionary(pool: Pool, words: LibraryWord[]) {
  const count = Number((await pool.query('SELECT count(DISTINCT term) FROM dictionary_entries')).rows[0].count);
  if (count !== words.length) throw new Error('Dictionary word count differs from the selected source.');
  let definitions = 0;
  for (let offset = 0; offset < words.length; offset += 500) {
    const batch = words.slice(offset, offset + 500);
    const rows = (await pool.query(`SELECT e.term,(jsonb_agg(e.source_metadata->'word')->0) source_metadata,
      jsonb_object_agg(e.part_of_speech,jsonb_build_object('metadata',e.source_metadata-'word',
        'meanings',(SELECT jsonb_agg(jsonb_build_object('definition',d.definition,'source',d.source_label) ORDER BY d.sense_order)
          FROM dictionary_definitions d WHERE d.dictionary_entry_id=e.id AND d.language_code='en'))) entries
      FROM dictionary_entries e WHERE e.term=ANY($1::text[]) GROUP BY e.term`, [batch.map(word => word.term)])).rows;
    const actual = new Map(rows.map(row => [row.term, row]));
    for (const word of batch) {
      const { term, definition, part_of_speech, senses, ...metadata } = word;
      const entries: Record<string, { metadata: { groups: unknown[] }; meanings: { definition: string; source: string | null }[] }> = {};
      for (const sense of senses) {
        const { definitions: meanings, ...group } = sense;
        const position = sense.partOfSpeech === 'numeral' ? 'number' : sense.partOfSpeech;
        const entry = entries[position] ??= { metadata: { groups: [] }, meanings: [] };
        entry.metadata.groups.push(group);
        entry.meanings.push(...meanings.map(value => ({ definition: value, source: sense.source ?? null })));
        definitions += meanings.length;
      }
      const row = actual.get(term);
      if (!row || !isDeepStrictEqual(row.source_metadata, { ...metadata, sourcePartsOfSpeech: part_of_speech })
        || !isDeepStrictEqual(row.entries, entries)) throw new Error('Dictionary content or provenance differs for: ' + term);
    }
  }
  const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(row => row.tablename);
  if (tables.length !== 18) throw new Error('Expected 18 application tables.');
  if ((await pool.query("SELECT 1 FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated LIMIT 1")).rowCount) {
    throw new Error('An unvalidated database constraint remains.');
  }
  const counts = (await pool.query(`SELECT
    (SELECT count(DISTINCT term)::int FROM dictionary_entries WHERE term<>lower(term COLLATE "default")) case_preserved,
    (SELECT count(*)::int FROM account_users) accounts,
    (SELECT count(*)::int FROM user_words) personal_words,
    (SELECT count(*)::int FROM practice_games) games`)).rows[0];
  return { words: count, definitions, casePreservedWords: counts.case_preserved,
    accounts: counts.accounts, personalWords: counts.personal_words, games: counts.games, tables, verified: true };
}

export async function connectWorktree(database: URL) {
  const root = resolve(__dirname, '..');
  const template = await readFile(resolve(root, '.env.example'), 'utf8');
  await writeFile(resolve(root, '.env'), template.replace(/^DATABASE_URL=.*$/m, 'DATABASE_URL=' + database.href));
}
