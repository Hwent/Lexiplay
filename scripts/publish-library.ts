import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { parseArgs, parseEnv } from 'node:util';
import { Pool } from '../apps/api/node_modules/pg';
import { dictionaryFingerprint, publishDictionary, type LibraryWord } from '../apps/api/src/modules/word-lists/library-maintenance';
import { isDeepStrictEqual } from 'node:util';
import { backupDatabase, connectWorktree, localDatabase, verifyDictionary } from './database-maintenance';

async function main() {
  const { values } = parseArgs({ options: {
    'database-env': { type: 'string', default: '.env' }, dictionary: { type: 'string' },
    'expected-words': { type: 'string' }, 'writers-paused': { type: 'boolean' }, connect: { type: 'boolean' },
    apply: { type: 'string' },
  } });
  if (!values.dictionary || !values['expected-words'] || (values.apply && !values['writers-paused'])) {
    throw new Error('Use --dictionary <dictionary.jsonl.gz> --expected-words <count>. Review the report, then use --apply <report.json> --writers-paused to publish.');
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
  const pool = new Pool({ connectionString: database.href });
  try {
    const baseVersion = (await pool.query('SELECT version FROM library_state WHERE id=1')).rows[0].version;
    const current = (await pool.query(`SELECT e.term,e.part_of_speech,e.source_metadata,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('definition',d.definition,'source',d.source_label) ORDER BY d.sense_order)
        FROM dictionary_definitions d WHERE d.dictionary_entry_id=e.id AND d.language_code='en'),'[]'::jsonb) meanings,
      (SELECT count(*)::int FROM user_words u WHERE u.dictionary_entry_id=e.id) personal_references,
      (SELECT count(*)::int FROM collection_entries c WHERE c.dictionary_entry_id=e.id) collection_references,
      (SELECT count(*)::int FROM dictionary_definitions d WHERE d.dictionary_entry_id=e.id AND d.language_code<>'en') translated_meanings
      FROM dictionary_entries e ORDER BY e.term,e.part_of_speech`)).rows;
    const incoming = new Map<string, {term:string; part_of_speech:string; source_metadata:{word:unknown;groups:unknown[]}; meanings:unknown[]}>();
    for (const word of words) {
      const {term,definition,part_of_speech,senses,...metadata} = word;
      for (const sense of senses) {
        const position = sense.partOfSpeech === 'numeral' ? 'number' : sense.partOfSpeech;
        const key = JSON.stringify([term,position]);
        const entry = incoming.get(key) ?? {term,part_of_speech:position,
          source_metadata:{word:{...metadata,sourcePartsOfSpeech:part_of_speech},groups:[]},meanings:[]};
        const {definitions,...group} = sense;
        entry.source_metadata.groups.push(group);
        entry.meanings.push(...definitions.map(definition => ({definition,source:sense.source ?? null})));
        incoming.set(key,entry);
      }
    }
    const existing = new Map(current.map(row => [JSON.stringify([row.term,row.part_of_speech]),row]));
    const removed = current.filter(row => !incoming.has(JSON.stringify([row.term,row.part_of_speech])));
    const added = [...incoming].filter(([key]) => !existing.has(key)).map(([,row]) => row);
    const changed = [...incoming].filter(([key,row]) => {
      const before = existing.get(key);
      return before && (!isDeepStrictEqual(before.source_metadata,row.source_metadata) || !isDeepStrictEqual(before.meanings,row.meanings));
    }).map(([key,after]) => ({before:existing.get(key),after}));
    const report = {targetDatabase:database.pathname.slice(1),baseVersion,fingerprint:dictionaryFingerprint(words),
      added,removed,changed};
    const reportPath = resolve(folder,'differences.json');
    await writeFile(reportPath,JSON.stringify(report,null,2));
    console.log(JSON.stringify({added:added.length,removed:removed.length,changed:changed.length,report:reportPath},null,2));
    if (!values.apply) { console.log('Report only. No database changes were made. Awaiting further instruction.'); return; }
    const approved = JSON.parse(await readFile(resolve(values.apply),'utf8'));
    if (!isDeepStrictEqual(approved,report)) throw new Error('The reviewed report no longer matches the database and input. Review the new report before applying.');
    if (removed.some(row => row.personal_references || row.collection_references)) {
      throw new Error('Removed entries still have personal or collection references. Resolve the reported differences before applying.');
    }
    console.log('Backing up the database before publication...');
    await backupDatabase(database, folder);
    const imported = await publishDictionary(pool, words);
    console.log('Verifying every spelling, meaning, and source metadata...');
    const verified = await verifyDictionary(pool, words);
    const verification = { targetDatabase: database.pathname.slice(1), ...imported, ...verified };
    await writeFile(resolve(folder, 'verification.json'), JSON.stringify(verification, null, 2));
    if (values.connect) await connectWorktree(database);
    console.log(JSON.stringify(verification, null, 2));
    console.log('Recovery files: ' + folder);
  } finally { await pool.end(); }
}
void main().catch(error => {
  console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[database URL]') : 'Dictionary publication failed.');
  process.exitCode = 1;
});
