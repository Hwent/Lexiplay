import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import properNouns from './proper-nouns.json';

export async function importProperNouns(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('library-publication',0))");
    await client.query('SELECT version FROM library_state WHERE id=1 FOR UPDATE');
    let entriesAdded = 0, definitionsAdded = 0;
    const data = JSON.stringify(properNouns.entries);
    entriesAdded = (await client.query(`INSERT INTO dictionary_entries(term,part_of_speech,source_metadata)
      SELECT value->>'term','proper noun',jsonb_build_object('origin','simple-wiktionary-proper-nouns',
        'snapshot',$2::text,'revisionId',value->>'revisionId','gameEligible',(value->>'term') ~ '^[A-Za-z]{3,9}$',
        'sourceUrl','https://simple.wiktionary.org/w/index.php?oldid='||(value->>'revisionId'))
      FROM jsonb_array_elements($1::jsonb) ON CONFLICT(term,part_of_speech) DO NOTHING`,
    [data, properNouns.snapshot])).rowCount ?? 0;
    // Add missing definitions while preserving all existing senses and user references.
    definitionsAdded = (await client.query(`INSERT INTO dictionary_definitions(dictionary_entry_id,language_code,sense_order,definition,source_label)
      SELECT e.id,'en',coalesce((SELECT max(d.sense_order)+1 FROM dictionary_definitions d
        WHERE d.dictionary_entry_id=e.id AND d.language_code='en'),0)+(definition.position-1)::int,
        definition.text,'simple-wiktionary'
      FROM jsonb_array_elements($1::jsonb) item
      JOIN dictionary_entries e ON e.term=item->>'term' AND e.part_of_speech='proper noun'
      CROSS JOIN LATERAL jsonb_array_elements_text(item->'definitions') WITH ORDINALITY definition(text,position)
      WHERE NOT EXISTS(SELECT 1 FROM dictionary_definitions d WHERE d.dictionary_entry_id=e.id
        AND d.language_code='en' AND d.definition=definition.text)`, [data])).rowCount ?? 0;
    if (entriesAdded || definitionsAdded) await client.query('UPDATE library_state SET version=$1 WHERE id=1', [randomUUID()]);
    await client.query('COMMIT');
    return { entriesAdded, definitionsAdded };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
