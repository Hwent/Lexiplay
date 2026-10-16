import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { Pool, PoolClient } from 'pg';
import { DictionaryRecord, WORDNET_SOURCE, WORDNET_URL, WordnetLexicon, WordnetSynsets, supplementDictionary, wordnetRecords } from './english-wordnet';

type ImportSource = { records: DictionaryRecord[]; synsetCount: number; lexicalEntryCount: number; contentSha256: string; archiveSha256: string | null };
type ImportReport = { mode: string; source: string; sourceTerms: number; sourceLexicalEntries: number; sourceSynsets: number; inserted: number; supplemented: number; preserved: number; totalBefore: number; totalAfter: number; cefrMissingBefore: number; cefrMissingAfter: number; backup: string | null; archiveSha256: string | null; contentSha256: string };

export async function readWordnet(directory: string, archive?: string): Promise<ImportSource> {
  const files = (await readdir(directory)).filter(file => /^(?:entries-[a-z0-9]|(?:noun|verb|adj|adv)\.[a-z]+)\.json$/i.test(file)).sort();
  const lexicon: WordnetLexicon = {}, synsets: WordnetSynsets = {};
  const digest = createHash('sha256');
  for (const file of files) {
    const bytes = await readFile(resolve(directory, file)); digest.update(file + '\0'); digest.update(bytes);
    const data = JSON.parse(bytes.toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Unsupported WordNet JSON export.');
    const target = file.startsWith('entries-') ? lexicon : synsets;
    for (const key of Object.keys(data)) {
      if (Object.hasOwn(target, key)) throw new Error('Duplicate WordNet source identity.');
      Object.defineProperty(target, key, { value: data[key], enumerable: true });
    }
  }
  const lexicalEntryCount = Object.values(lexicon).reduce((total, entry) => total + Object.keys(entry).length, 0);
  const records = wordnetRecords(lexicon, synsets);
  if (lexicalEntryCount < 100_000 || Object.keys(synsets).length < 100_000 || !records.some(record => record.term === 'bank') || !records.some(record => record.term === 'run')) throw new Error('Incomplete WordNet 2025 core export; no dictionary data was changed.');
  return { records, synsetCount: Object.keys(synsets).length, lexicalEntryCount, contentSha256: digest.digest('hex'), archiveSha256: archive ? createHash('sha256').update(await readFile(archive)).digest('hex') : null };
}

async function cefrMissing(client: PoolClient) {
  const { rows } = await client.query<{ missing: number }>(`SELECT count(*)::int AS missing FROM dictionary_entries e
    WHERE EXISTS(SELECT 1 FROM collection_entries c WHERE c.dictionary_entry_id=e.id)
      AND NOT EXISTS(SELECT 1 FROM dictionary_words w CROSS JOIN LATERAL jsonb_array_elements(w.senses) s
        WHERE lower(w.term)=e.normalized_lemma AND (s->>'partOfSpeech'=e.part_of_speech OR (e.part_of_speech='number' AND s->>'partOfSpeech'='numeral'))
          AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(s->'definitions') d WHERE btrim(d.value)<>''))`);
  return rows[0]!.missing;
}

export async function importWordnet(pool: Pool, source: ImportSource, apply: boolean, backupDirectory: string): Promise<ImportReport> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE dictionary_words IN SHARE ROW EXCLUSIVE MODE');
    const { rows } = await client.query<DictionaryRecord>('SELECT term,definition,part_of_speech AS "partOfSpeech",senses FROM dictionary_words ORDER BY term');
    const existing = new Map(rows.map(row => [row.term, row]));
    const missingBefore = await cefrMissing(client);
    const changed: DictionaryRecord[] = [];
    let inserted = 0, supplemented = 0, preserved = 0;
    for (const incoming of source.records) {
      const old = existing.get(incoming.term);
      const next = supplementDictionary(old, incoming);
      if (!next.changed) { preserved++; continue; }
      if (old) supplemented++; else inserted++;
      changed.push(next.record); existing.set(next.record.term, next.record);
    }
    let backup: string | null = null;
    if (apply) {
      await mkdir(backupDirectory, { recursive: true });
      backup = resolve(backupDirectory, 'dictionary-before-wordnet-' + Date.now() + '.json.gz');
      await writeFile(backup, await promisify(gzip)(JSON.stringify({ format: 1, words: rows })), { flag: 'wx' });
    }
    await client.query(`CREATE TABLE IF NOT EXISTS dictionary_sources (
      id text PRIMARY KEY, name text NOT NULL, version text NOT NULL, url text NOT NULL, license text NOT NULL,
      content_sha256 text NOT NULL, archive_sha256 text, imported_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS dictionary_source_words (
        source_id text NOT NULL REFERENCES dictionary_sources(id), term text NOT NULL, data jsonb NOT NULL,
        PRIMARY KEY(source_id,term));`);
    await client.query(`INSERT INTO dictionary_sources(id,name,version,url,license,content_sha256,archive_sha256)
      VALUES($1,'Open English WordNet','2025',$2,'CC-BY-4.0; Princeton WordNet notice',$3,$4)
      ON CONFLICT(id) DO UPDATE SET content_sha256=EXCLUDED.content_sha256,archive_sha256=EXCLUDED.archive_sha256,imported_at=now()`, [WORDNET_SOURCE, WORDNET_URL, source.contentSha256, source.archiveSha256]);
    for (let index = 0; index < source.records.length; index += 1000) {
      const batch = source.records.slice(index, index + 1000);
      await client.query(`INSERT INTO dictionary_source_words(source_id,term,data)
        SELECT $1,row.term,row.data::jsonb FROM UNNEST($2::text[],$3::text[]) row(term,data)
        ON CONFLICT(source_id,term) DO UPDATE SET data=EXCLUDED.data WHERE dictionary_source_words.data IS DISTINCT FROM EXCLUDED.data`, [WORDNET_SOURCE, batch.map(row => row.term), batch.map(row => JSON.stringify(row))]);
    }
    for (let index = 0; index < changed.length; index += 1000) {
      const batch = changed.slice(index, index + 1000);
      await client.query(`INSERT INTO dictionary_words(term,definition,part_of_speech,senses)
        SELECT row.term,row.definition,string_to_array(row.positions,','),row.senses::jsonb
        FROM UNNEST($1::text[],$2::text[],$3::text[],$4::text[]) row(term,definition,positions,senses)
        ON CONFLICT(term) DO UPDATE SET definition=EXCLUDED.definition,part_of_speech=EXCLUDED.part_of_speech,senses=EXCLUDED.senses`, [batch.map(row => row.term), batch.map(row => row.definition), batch.map(row => row.partOfSpeech.join(',')), batch.map(row => JSON.stringify(row.senses))]);
    }
    const missingAfter = await cefrMissing(client);
    const totalAfter = Number((await client.query('SELECT count(*)::int AS count FROM dictionary_words')).rows[0].count);
    const report = { mode: apply ? 'applied' : 'dry-run (rolled back)', source: WORDNET_SOURCE, sourceTerms: source.records.length, sourceLexicalEntries: source.lexicalEntryCount, sourceSynsets: source.synsetCount, inserted, supplemented, preserved, totalBefore: rows.length, totalAfter, cefrMissingBefore: missingBefore, cefrMissingAfter: missingAfter, backup, archiveSha256: source.archiveSha256, contentSha256: source.contentSha256 };
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    return report;
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}

async function main() {
  const root = resolve(__dirname, '../../../../..');
  if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
  const value = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
  const database = new URL(process.env.DATABASE_URL ?? 'postgresql://lexiplay:lexiplay@127.0.0.1:5432/lexiplay');
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname)) throw new Error('WordNet supplementation requires a local development database.');
  const directory = resolve(value('--directory') ?? resolve(root, '.local-backups/wordnet-2025/json'));
  const archive = value('--archive') ?? resolve(root, '.local-backups/wordnet-2025/english-wordnet-2025-json.zip');
  const source = await readWordnet(directory, existsSync(archive) ? archive : undefined);
  const pool = new Pool({ connectionString: database.href });
  try {
    const report = await importWordnet(pool, source, process.argv.includes('--apply'), resolve(root, '.local-backups'));
    console.log(JSON.stringify(report, null, 2));
    if (value('--report')) await writeFile(resolve(value('--report')!), JSON.stringify(report, null, 2));
  } finally { await pool.end(); }
}
if (require.main === module) void main().catch(error => { console.error(error instanceof Error ? error.message : 'WordNet import failed.'); process.exitCode = 1; });
