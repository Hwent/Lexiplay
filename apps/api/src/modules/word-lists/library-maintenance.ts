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

export async function publishDictionary(pool: Pool, words: LibraryWord[], origin: string) {
  if (!words.length) throw new Error('Refusing to publish an empty dictionary.');
  const fingerprint = dictionaryFingerprint(words);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('library-publication',0))");
    const prior = await client.query("SELECT id FROM library_revisions WHERE scope='dictionary' AND fingerprint=$1 AND is_current", [fingerprint]);
    if (prior.rowCount) {
      await updateFamilies(client);
      await publishCollections(client);
      const cancelled = await cancelUnplayableGames(client);
      await client.query('COMMIT');
      return { revision: prior.rows[0].id, words: words.length, cancelled, unchanged: true };
    }
    let revision = randomUUID();
    await client.query("UPDATE library_revisions SET is_current=false WHERE scope='dictionary' AND is_current");
    const published = await client.query(`INSERT INTO library_revisions(id,scope,fingerprint,is_current,metadata)
      VALUES($1,'dictionary',$2,true,$3)
      ON CONFLICT(scope,fingerprint) DO UPDATE SET is_current=true,published_at=now(),metadata=EXCLUDED.metadata RETURNING id`,
      [revision, fingerprint, JSON.stringify({ origin, wordCount: words.length })]);
    revision = published.rows[0].id;
    await client.query('UPDATE dictionary_words SET retired_at=now() WHERE retired_at IS NULL');
    await client.query('UPDATE dictionary_entries SET retired_at=now() WHERE retired_at IS NULL');
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
      await client.query(`INSERT INTO dictionary_words(term,revision_id,source_metadata)
        SELECT value->>'term',$2,(value-'term'-'definition'-'part_of_speech'-'senses')
          || jsonb_build_object('sourcePartsOfSpeech',value->'part_of_speech')
        FROM jsonb_array_elements($1::jsonb)
        ON CONFLICT(term) DO UPDATE SET revision_id=EXCLUDED.revision_id,source_metadata=EXCLUDED.source_metadata,retired_at=NULL,updated_at=now()`, [data, revision]);
      await client.query(`INSERT INTO dictionary_entries(word_id,part_of_speech,source_metadata)
        SELECT w.id,CASE WHEN s.value->>'partOfSpeech'='numeral' THEN 'number' ELSE s.value->>'partOfSpeech' END,
          jsonb_build_object('groups',jsonb_agg(s.value-'definitions' ORDER BY s.position))
        FROM jsonb_array_elements($1::jsonb) raw
        JOIN dictionary_words w ON w.term=raw->>'term'
        CROSS JOIN LATERAL jsonb_array_elements(raw->'senses') WITH ORDINALITY s(value,position)
        GROUP BY w.id,CASE WHEN s.value->>'partOfSpeech'='numeral' THEN 'number' ELSE s.value->>'partOfSpeech' END
        ON CONFLICT(word_id,part_of_speech) DO UPDATE SET source_metadata=EXCLUDED.source_metadata,retired_at=NULL`, [data]);
      await client.query(`DELETE FROM dictionary_definitions d USING dictionary_entries e,dictionary_words w
        WHERE d.dictionary_entry_id=e.id AND e.word_id=w.id AND w.term IN (SELECT value->>'term' FROM jsonb_array_elements($1::jsonb))`, [data]);
      await client.query(`INSERT INTO dictionary_definitions(dictionary_entry_id,sense_order,definition,source_label)
        SELECT e.id,(row_number() OVER(PARTITION BY e.id ORDER BY s.position,d.position)-1)::int,d.value,s.value->>'source'
        FROM jsonb_array_elements($1::jsonb) raw
        JOIN dictionary_words w ON w.term=raw->>'term'
        CROSS JOIN LATERAL jsonb_array_elements(raw->'senses') WITH ORDINALITY s(value,position)
        JOIN dictionary_entries e ON e.word_id=w.id AND e.part_of_speech=CASE WHEN s.value->>'partOfSpeech'='numeral' THEN 'number' ELSE s.value->>'partOfSpeech' END
        CROSS JOIN LATERAL jsonb_array_elements_text(s.value->'definitions') WITH ORDINALITY d(value,position)`, [data]);
    }
    const expected = words.reduce((count, word) => count + word.senses.reduce((sum, sense) => sum + sense.definitions.length, 0), 0);
    const totals = (await client.query(`SELECT (SELECT count(*)::int FROM dictionary_words WHERE retired_at IS NULL) words,
      (SELECT count(*)::int FROM dictionary_definitions d JOIN dictionary_entries e ON e.id=d.dictionary_entry_id
       JOIN dictionary_words w ON w.id=e.word_id WHERE e.retired_at IS NULL AND w.retired_at IS NULL) definitions`)).rows[0];
    if (totals.words !== words.length || totals.definitions !== expected) throw new Error('Dictionary normalization did not preserve every spelling and structured meaning.');
    await updateFamilies(client);
    await publishCollections(client);
    const cancelled = await cancelUnplayableGames(client);
    await client.query('COMMIT');
    return { revision, words: totals.words, definitions: totals.definitions, cancelled, unchanged: false };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function updateFamilies(client: PoolClient) {
  const terms = new Set((await client.query<{term:string}>('SELECT term FROM dictionary_words WHERE retired_at IS NULL')).rows.map(row => row.term));
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
  await client.query('UPDATE dictionary_words SET family_id=NULL WHERE family_id IS NOT NULL');
  for (let offset = 0; offset < members.length; offset += 2000) {
    const rows = members.slice(offset, offset + 2000).map(([term, value]) => ({ term, family: `bnc-coca-v1:${Number(value[1])}:${String(value[0])}` }));
    await client.query(`UPDATE dictionary_words w SET family_id=value->>'family'
      FROM jsonb_array_elements($1::jsonb) WHERE w.term=value->>'term'`, [JSON.stringify(rows)]);
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(familyData)).digest('hex');
  await client.query("UPDATE library_revisions SET is_current=false WHERE scope='families' AND is_current");
  await client.query(`INSERT INTO library_revisions(scope,fingerprint,is_current,metadata) VALUES('families',$1,true,$2)
    ON CONFLICT(scope,fingerprint) DO UPDATE SET is_current=true`, [fingerprint, source]);
}

export async function publishCollections(client: PoolClient) {
  const fingerprint = createHash('sha256').update(JSON.stringify(CEFR_POOLS)).digest('hex');
  await client.query("UPDATE library_revisions SET is_current=false WHERE scope='collections' AND is_current");
  const revision = (await client.query(`INSERT INTO library_revisions(scope,fingerprint,is_current) VALUES('collections',$1,true)
    ON CONFLICT(scope,fingerprint) DO UPDATE SET is_current=true RETURNING id`, [fingerprint])).rows[0].id;
  for (const pool of CEFR_POOLS) {
    const collection = (await client.query(`INSERT INTO vocabulary_collections(slug,name,description,category,author,source_name,source_version,source_url,license,revision_id)
      VALUES($1,$2,$3,'CEFR',$4,$5,$6,$7,$8,$9)
      ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,author=EXCLUDED.author,
        source_name=EXCLUDED.source_name,source_version=EXCLUDED.source_version,source_url=EXCLUDED.source_url,
        license=EXCLUDED.license,revision_id=EXCLUDED.revision_id,status='available' RETURNING id`,
      ['cefr-' + pool.level.toLowerCase(), pool.name, pool.description ?? `Vocabulary for CEFR ${pool.level}.`, pool.author,
        pool.author, pool.version ?? 'supplied-2026-10-14', pool.source ?? null, pool.license ?? null, revision])).rows[0].id;
    const members = pool.words.flatMap((word, index) => word.partsOfSpeech.map(position => ({ term: word.term, position: normalizePosition(position), order: index })));
    await client.query('DELETE FROM collection_entries WHERE collection_id=$1', [collection]);
    await client.query(`INSERT INTO collection_entries(collection_id,dictionary_entry_id,sort_order)
      SELECT $1,e.id,(value->>'order')::int FROM jsonb_array_elements($2::jsonb)
      JOIN dictionary_words w ON w.term=value->>'term' AND w.retired_at IS NULL
      JOIN dictionary_entries e ON e.word_id=w.id AND e.part_of_speech=value->>'position' AND e.retired_at IS NULL
      WHERE EXISTS(SELECT 1 FROM dictionary_definitions d WHERE d.dictionary_entry_id=e.id)
      ON CONFLICT(collection_id,dictionary_entry_id) DO NOTHING`, [collection, JSON.stringify(members)]);
  }
  for (const [slug, name, category] of [['ielts-core', 'IELTS Core Vocabulary', 'IELTS'], ['toefl-academic', 'TOEFL Academic Vocabulary', 'TOEFL']]) {
    await client.query(`INSERT INTO vocabulary_collections(slug,name,description,category,revision_id,status)
      VALUES($1,$2,'Source data has not been supplied yet.',$3,$4,'awaiting_data')
      ON CONFLICT(slug) DO UPDATE SET revision_id=EXCLUDED.revision_id`, [slug, name, category, revision]);
  }
  // Existing rows include explicit exclusions and learning progress: never overwrite them.
  await client.query(`INSERT INTO user_words(user_id,dictionary_entry_id,stage)
    SELECT u.user_id,e.dictionary_entry_id,e.stage FROM user_vocabulary_collections u
    JOIN vocabulary_collections c ON c.id=u.collection_id AND c.status='available'
    JOIN collection_entries e ON e.collection_id=c.id
    ON CONFLICT(user_id,dictionary_entry_id) DO NOTHING`);
}

export async function cancelUnplayableGames(client: PoolClient) {
  // Gameplay identifies answers by normalized spelling, even when a dictionary's case identity changes.
  await client.query(`UPDATE practice_games g SET answer_word_id=replacement.id
    FROM dictionary_words old CROSS JOIN LATERAL (
      SELECT w.id FROM dictionary_words w WHERE w.retired_at IS NULL AND lower(w.term)=lower(old.term)
        AND EXISTS(SELECT 1 FROM dictionary_entries e JOIN dictionary_definitions d ON d.dictionary_entry_id=e.id
          WHERE e.word_id=w.id AND e.retired_at IS NULL)
      ORDER BY (w.term=lower(old.term)) DESC,w.term LIMIT 1
    ) replacement
    WHERE g.answer_word_id=old.id AND g.status='active' AND old.retired_at IS NOT NULL
      AND lower(old.term) ~ '^[a-z]{3,9}$' AND char_length(old.term)=g.word_length`);
  const games = (await client.query(`SELECT g.* FROM practice_games g JOIN dictionary_words w ON w.id=g.answer_word_id
    WHERE g.status='active' AND (w.retired_at IS NOT NULL OR lower(w.term) !~ '^[a-z]{3,9}$' OR char_length(w.term)<>g.word_length
      OR NOT EXISTS(SELECT 1 FROM dictionary_entries e JOIN dictionary_definitions d ON d.dictionary_entry_id=e.id
        WHERE e.word_id=w.id AND e.retired_at IS NULL)) ORDER BY g.id FOR UPDATE OF g`)).rows;
  for (const game of games) {
    if (game.coin_user_id) await client.query('UPDATE account_users SET coin_balance=coin_balance+$2 WHERE id=$1', [game.coin_user_id, game.coin_cost]);
    else await client.query('UPDATE guest_sessions SET coin_balance=coin_balance+$2 WHERE id=$1', [game.coin_guest_session_id, game.coin_cost]);
    await client.query(`UPDATE practice_games SET status='cancelled',finished_at=now(),cost_refunded_at=now(),
      cancellation_reason='The answer is no longer playable in the current dictionary.' WHERE id=$1`, [game.id]);
  }
  return games.length;
}
