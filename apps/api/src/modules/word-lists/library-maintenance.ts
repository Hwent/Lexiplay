import { createHash, randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { CEFR_POOLS } from './cefr-pools';
import familyData from './family-data/bnc-coca.json';

export type LibraryWord = {
  term: string;
  definition: string;
  part_of_speech: string[];
  senses: { partOfSpeech: string; definitions: string[]; source?: string; [key: string]: unknown }[];
  [key: string]: unknown;
};

const normalizePosition = (value: string) => value === 'numeral' ? 'number' : value;
export function dictionaryFingerprint(words: LibraryWord[]) {
  const hash = createHash('sha256').update('lexiplay-canonical-v1\n');
  for (const word of words) hash.update(JSON.stringify(word) + '\n');
  return hash.digest('hex');
}

export async function publishDictionary(pool: Pool, words: LibraryWord[]) {
  if (!words.length) throw new Error('Refusing to publish an empty dictionary.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('library-publication',0))");
    const existing = (await client.query('SELECT term,part_of_speech FROM dictionary_entries')).rows;
    const incoming = new Set(words.flatMap(word => word.senses.map(sense => JSON.stringify([word.term,normalizePosition(sense.partOfSpeech)]))));
    const removed = existing.filter(row => !incoming.has(JSON.stringify([row.term,row.part_of_speech])));
    if (removed.length) {
      const references = (await client.query(`SELECT e.term,e.part_of_speech,
        (SELECT count(*)::int FROM user_words u WHERE u.dictionary_entry_id=e.id) personal_references,
        (SELECT count(*)::int FROM collection_entries c WHERE c.dictionary_entry_id=e.id) collection_references
        FROM dictionary_entries e WHERE (e.term,e.part_of_speech) IN
          (SELECT value->>0,value->>1 FROM jsonb_array_elements($1::jsonb))`,
        [JSON.stringify(removed.map(row => [row.term,row.part_of_speech]))])).rows;
      if (references.some(row => row.personal_references || row.collection_references)) {
        throw new Error('Dictionary removals have unresolved references. Review the difference report before applying.');
      }
    }
    for (let offset = 0; offset < words.length; offset += 500) {
      const batch = words.slice(offset, offset + 500);
      for (const word of batch) {
        if (!word.term?.trim() || !Array.isArray(word.senses) || !word.senses.length) throw new Error('Dictionary words require a spelling and structured senses.');
        for (const sense of word.senses) {
          if (!sense.partOfSpeech?.trim() || !Array.isArray(sense.definitions) || sense.definitions.some(value => typeof value !== 'string' || !value.trim())) {
            throw new Error('Dictionary senses require a part of speech and nonempty meanings.');
          }
        }
      }
      const data = JSON.stringify(batch);
      await client.query(`INSERT INTO dictionary_entries(term,part_of_speech,source_metadata)
        SELECT raw->>'term',CASE WHEN s.value->>'partOfSpeech'='numeral' THEN 'number' ELSE s.value->>'partOfSpeech' END,
          jsonb_build_object('word',(raw-'term'-'definition'-'part_of_speech'-'senses')
            || jsonb_build_object('sourcePartsOfSpeech',raw->'part_of_speech'),
            'groups',jsonb_agg(s.value-'definitions' ORDER BY s.position))
        FROM jsonb_array_elements($1::jsonb) raw
        CROSS JOIN LATERAL jsonb_array_elements(raw->'senses') WITH ORDINALITY s(value,position)
        GROUP BY raw,CASE WHEN s.value->>'partOfSpeech'='numeral' THEN 'number' ELSE s.value->>'partOfSpeech' END
        ON CONFLICT(term,part_of_speech) DO UPDATE SET source_metadata=EXCLUDED.source_metadata`, [data]);
      await client.query(`DELETE FROM dictionary_definitions d USING dictionary_entries e
        WHERE d.dictionary_entry_id=e.id AND d.language_code='en'
          AND e.term IN (SELECT value->>'term' FROM jsonb_array_elements($1::jsonb))`, [data]);
      await client.query(`INSERT INTO dictionary_definitions(dictionary_entry_id,sense_order,definition,source_label)
        SELECT e.id,(row_number() OVER(PARTITION BY e.id ORDER BY s.position,d.position)-1)::int,d.value,s.value->>'source'
        FROM jsonb_array_elements($1::jsonb) raw
        CROSS JOIN LATERAL jsonb_array_elements(raw->'senses') WITH ORDINALITY s(value,position)
        JOIN dictionary_entries e ON e.term=raw->>'term' AND e.part_of_speech=CASE WHEN s.value->>'partOfSpeech'='numeral' THEN 'number' ELSE s.value->>'partOfSpeech' END
        CROSS JOIN LATERAL jsonb_array_elements_text(s.value->'definitions') WITH ORDINALITY d(value,position)`, [data]);
    }
    if (removed.length) await client.query(`DELETE FROM dictionary_entries WHERE (term,part_of_speech) IN
      (SELECT value->>0,value->>1 FROM jsonb_array_elements($1::jsonb))`, [JSON.stringify(removed.map(row => [row.term,row.part_of_speech]))]);
    const expected = words.reduce((count, word) => count + word.senses.reduce((sum, sense) => sum + sense.definitions.length, 0), 0);
    const totals = (await client.query(`SELECT (SELECT count(DISTINCT term)::int FROM dictionary_entries) words,
      (SELECT count(*)::int FROM dictionary_definitions WHERE language_code='en') definitions`)).rows[0];
    if (totals.words !== words.length || totals.definitions !== expected) throw new Error('Dictionary normalization did not preserve every spelling and structured meaning.');
    await updateFamilies(client);
    await publishCollections(client);
    const cancelled = await cancelUnplayableGames(client);
    const version = randomUUID();
    await client.query('UPDATE library_state SET version=$1 WHERE id=1', [version]);
    await client.query('COMMIT');
    return { version, words: totals.words, definitions: totals.definitions, cancelled };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function updateFamilies(client: PoolClient) {
  const terms = new Set((await client.query<{term:string}>('SELECT DISTINCT term FROM dictionary_entries')).rows.map(row => row.term));
  const members = Object.entries(familyData.members).filter(([term]) => terms.has(term));
  const source = { name: 'BNC/COCA word families', version: 'bnc-coca-v1' };
  const families = new Map<string, { id: string; headword: string; band: number }>();
  for (const [, value] of members) {
    const headword = String(value[0]), band = Number(value[1]);
    const id = `bnc-coca-v1:${band}:${headword}`;
    families.set(id, { id, headword, band });
  }
  const familyRows = [...families.values()];
  for (let offset = 0; offset < familyRows.length; offset += 1000) {
    const rows = familyRows.slice(offset, offset + 1000);
    await client.query(`INSERT INTO word_families(id,headword,band,source_metadata)
      SELECT value->>'id',value->>'headword',(value->>'band')::smallint,$2 FROM jsonb_array_elements($1::jsonb)
      ON CONFLICT(id) DO UPDATE SET headword=EXCLUDED.headword,band=EXCLUDED.band,source_metadata=EXCLUDED.source_metadata`, [JSON.stringify(rows), source]);
  }
  await client.query('UPDATE dictionary_entries SET family_id=NULL WHERE family_id IS NOT NULL');
  for (let offset = 0; offset < members.length; offset += 2000) {
    const rows = members.slice(offset, offset + 2000).map(([term, value]) => ({ term, family: `bnc-coca-v1:${Number(value[1])}:${String(value[0])}` }));
    await client.query(`UPDATE dictionary_entries w SET family_id=value->>'family'
      FROM jsonb_array_elements($1::jsonb) WHERE w.term=value->>'term'`, [JSON.stringify(rows)]);
  }
}

export async function publishCollections(client: PoolClient) {
  for (const pool of CEFR_POOLS) {
    const collection = (await client.query(`INSERT INTO vocabulary_collections(slug,name,description,category,author,source_name,source_version,source_url,license)
      VALUES($1,$2,$3,'CEFR',$4,$5,$6,$7,$8)
      ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,author=EXCLUDED.author,
        source_name=EXCLUDED.source_name,source_version=EXCLUDED.source_version,source_url=EXCLUDED.source_url,
        license=EXCLUDED.license,status='available' RETURNING id`,
      ['cefr-' + pool.level.toLowerCase(), pool.name, pool.description ?? `Vocabulary for CEFR ${pool.level}.`, pool.author,
        pool.author, pool.version ?? 'supplied-2026-10-14', pool.source ?? null, pool.license ?? null])).rows[0].id;
    const members = pool.words.flatMap((word, index) => word.partsOfSpeech.map(position => ({ term: word.term, position: normalizePosition(position), order: index })));
    await client.query('DELETE FROM collection_entries WHERE collection_id=$1', [collection]);
    await client.query(`INSERT INTO collection_entries(collection_id,dictionary_entry_id,sort_order)
      SELECT $1,e.id,(value->>'order')::int FROM jsonb_array_elements($2::jsonb)
      JOIN dictionary_entries e ON e.term=value->>'term' AND e.part_of_speech=value->>'position'
      WHERE EXISTS(SELECT 1 FROM dictionary_definitions d WHERE d.dictionary_entry_id=e.id AND d.language_code='en')
      ON CONFLICT(collection_id,dictionary_entry_id) DO NOTHING`, [collection, JSON.stringify(members)]);
  }
  for (const [slug, name, category] of [['ielts-core', 'IELTS Core Vocabulary', 'IELTS'], ['toefl-academic', 'TOEFL Academic Vocabulary', 'TOEFL']]) {
    await client.query(`INSERT INTO vocabulary_collections(slug,name,description,category,status)
      VALUES($1,$2,'Source data has not been supplied yet.',$3,'awaiting_data')
      ON CONFLICT(slug) DO NOTHING`, [slug, name, category]);
  }
  // Existing rows include explicit exclusions and learning progress: never overwrite them.
  await client.query(`INSERT INTO user_words(user_id,dictionary_entry_id,stage)
    SELECT u.user_id,e.dictionary_entry_id,e.stage FROM user_vocabulary_collections u
    JOIN vocabulary_collections c ON c.id=u.collection_id AND c.status='available'
    JOIN collection_entries e ON e.collection_id=c.id
    ON CONFLICT(user_id,dictionary_entry_id) DO NOTHING`);
}

export async function cancelUnplayableGames(client: PoolClient) {
  const games = (await client.query(`SELECT * FROM practice_games g WHERE status='active'
    AND NOT EXISTS(SELECT 1 FROM dictionary_entries e JOIN dictionary_definitions d ON d.dictionary_entry_id=e.id
      WHERE lower(e.term COLLATE "default")=g.answer AND d.language_code='en') ORDER BY g.id FOR UPDATE`)).rows;
  for (const game of games) {
    const table = game.coin_user_id ? 'account_users' : 'guest_sessions';
    await client.query(`UPDATE ${table} SET coin_balance=coin_balance-$2 WHERE id=$1`, [game.coin_user_id ?? game.coin_guest_session_id, game.coin_change]);
    await client.query(`UPDATE practice_games SET status='cancelled',finished_at=now(),coin_change=0,
      active_state=NULL,collection_id=NULL WHERE id=$1`, [game.id]);
  }
  return games.length;
}
