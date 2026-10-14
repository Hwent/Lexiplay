import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { DictionaryRecord } from './english-wordnet';
import { importWordnet } from './seed-english-wordnet';
const testUrl = process.env.TEST_DATABASE_URL;
const oldTerm = 'wordnet-fixture-existing', newTerm = 'wordnet-fixture-new';
const records: DictionaryRecord[] = [
  { term: oldTerm, definition: 'New noun meaning.', partOfSpeech: ['noun'], senses: [{ partOfSpeech: 'noun', definitions: ['New noun meaning.'], source: 'oewn-2025' }] },
  { term: newTerm, definition: 'One; two; three', partOfSpeech: ['noun'], senses: [{ partOfSpeech: 'noun', definitions: ['One', 'Two', 'Three'], source: 'oewn-2025', synsetIds: ['fixture-1-n'] }] },
];
const source = { records, lexicalEntryCount: 2, synsetCount: 2, contentSha256: '0'.repeat(64), archiveSha256: null };
describe.skipIf(!testUrl)('WordNet supplementation with PostgreSQL', () => {
  let pool: Pool, backups: string;
  beforeAll(async () => {
    if (!new URL(testUrl!).pathname.startsWith('/lexiplay_test_')) throw new Error('Disposable test database required.');
    pool = new Pool({ connectionString: testUrl! });
    backups = await mkdtemp(join(tmpdir(), 'lexiplay-wordnet-test-'));
    await pool.query("CREATE TABLE IF NOT EXISTS dictionary_words(term text PRIMARY KEY,definition text NOT NULL,part_of_speech text[] NOT NULL DEFAULT '{}',senses jsonb NOT NULL DEFAULT '[]')");
  });
  beforeEach(async () => {
    await pool.query('DELETE FROM dictionary_words WHERE term=ANY($1::text[])', [[oldTerm, newTerm]]);
    if ((await pool.query("SELECT to_regclass('public.dictionary_source_words') AS present")).rows[0].present) await pool.query('DELETE FROM dictionary_source_words WHERE term=ANY($1::text[])', [[oldTerm, newTerm]]);
    await pool.query("INSERT INTO dictionary_words(term,definition,part_of_speech,senses) VALUES($1,'Existing definition.',ARRAY['verb'],'[{\"partOfSpeech\":\"verb\",\"definitions\":[\"Existing definition.\"]}]')", [oldTerm]);
  });
  afterAll(async () => {
    await pool?.query('DELETE FROM dictionary_words WHERE term=ANY($1::text[])', [[oldTerm, newTerm]]);
    await pool?.end();
    const target = resolve(backups), parent = resolve(tmpdir());
    if (!target.startsWith(parent + sep) || !target.slice(parent.length + 1).startsWith('lexiplay-wordnet-test-')) throw new Error('Unsafe temporary backup cleanup.');
    await rm(target, { recursive: true, force: true });
  });
  it('rolls back a dry run without changing canonical rows', async () => {
    const result = await importWordnet(pool, source, false, backups);
    expect(result).toMatchObject({ inserted: 1, supplemented: 1, backup: null });
    expect((await pool.query('SELECT definition,senses FROM dictionary_words WHERE term=$1', [oldTerm])).rows[0]).toEqual({ definition: 'Existing definition.', senses: [{ partOfSpeech: 'verb', definitions: ['Existing definition.'] }] });
    expect((await pool.query('SELECT 1 FROM dictionary_words WHERE term=$1', [newTerm])).rowCount).toBe(0);
  });
  it('preserves definitions, stores full provenance, creates a backup and is idempotent', async () => {
    const first = await importWordnet(pool, source, true, backups);
    expect(first).toMatchObject({ inserted: 1, supplemented: 1 }); expect(first.backup).toBeTruthy();
    const backup = JSON.parse((await promisify(gunzip)(await readFile(first.backup!))).toString('utf8'));
    expect(backup.words.find((word: DictionaryRecord) => word.term === oldTerm).definition).toBe('Existing definition.');
    const canonical = (await pool.query('SELECT definition,senses FROM dictionary_words WHERE term=$1', [newTerm])).rows[0];
    expect(canonical.senses[0].definitions).toEqual(['One', 'Two']);
    const original = (await pool.query('SELECT data FROM dictionary_source_words WHERE source_id=$1 AND term=$2', ['oewn-2025', newTerm])).rows[0].data;
    expect(original.senses[0].definitions).toHaveLength(3);
    const second = await importWordnet(pool, source, true, backups); expect(second).toMatchObject({ inserted: 0, supplemented: 0, preserved: 2 });
  });
  it('rolls back provenance and canonical changes together on a database write failure', async () => {
    await pool.query(`CREATE OR REPLACE FUNCTION test_wordnet_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture rejected'; END $$;
      CREATE TRIGGER test_wordnet_reject BEFORE INSERT OR UPDATE ON dictionary_words FOR EACH ROW WHEN (NEW.term='wordnet-fixture-new') EXECUTE FUNCTION test_wordnet_reject();`);
    try {
      await expect(importWordnet(pool, source, true, backups)).rejects.toThrow('fixture rejected');
      expect((await pool.query('SELECT definition,senses FROM dictionary_words WHERE term=$1', [oldTerm])).rows[0]).toMatchObject({ definition: 'Existing definition.', senses: [{ partOfSpeech: 'verb', definitions: ['Existing definition.'] }] });
      expect((await pool.query('SELECT 1 FROM dictionary_source_words WHERE source_id=$1 AND term=ANY($2::text[])', ['oewn-2025', [oldTerm, newTerm]])).rowCount).toBe(0);
    } finally { await pool.query('DROP TRIGGER test_wordnet_reject ON dictionary_words; DROP FUNCTION test_wordnet_reject()'); }
  });
});
