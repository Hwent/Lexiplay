import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { ThesaurusSense } from './webster-thesaurus';

export type ThesaurusPlan = { version: string; senses: (ThesaurusSense & { dictionaryEntryId: string | null })[] };
export async function planThesaurus(pool: Pool, senses: ThesaurusSense[]): Promise<ThesaurusPlan> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const version = (await client.query('SELECT version FROM library_state WHERE id=1')).rows[0].version;
    const rows = (await client.query<{ id: string; term: string; pos: string }>(`SELECT e.id,e.term,e.part_of_speech pos FROM dictionary_entries e
      WHERE e.term=ANY($1::text[]) AND EXISTS(SELECT 1 FROM dictionary_definitions d WHERE d.dictionary_entry_id=e.id AND d.language_code='en')`,
      [[...new Set(senses.map(sense => sense.term))]])).rows;
    const entries = new Map(rows.map(row => [JSON.stringify([row.term, row.pos]), row.id]));
    const unique = new Map(senses.map(sense => [JSON.stringify([sense.source, sense.sourceEntryId, sense.senseKey]), sense]));
    const selected = [...unique.values()].map(sense => ({ ...sense,
      dictionaryEntryId: entries.get(JSON.stringify([sense.term, sense.partOfSpeech])) ?? null }))
      .sort((a, b) => JSON.stringify([a.sourceEntryId, a.senseKey]).localeCompare(JSON.stringify([b.sourceEntryId, b.senseKey]), 'en'));
    await client.query('COMMIT');
    return { version, senses: selected };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export const thesaurusFingerprint = (plan: ThesaurusPlan) => createHash('sha256').update(JSON.stringify(plan)).digest('hex');

export async function applyThesaurus(pool: Pool, plan: ThesaurusPlan) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('thesaurus-import',0))");
    const state = (await client.query('SELECT version FROM library_state WHERE id=1')).rows[0];
    if (state.version !== plan.version) throw new Error('Dictionary changed. Generate a fresh thesaurus report.');
    let sensesAdded = 0, relationsAdded = 0;
    for (let offset = 0; offset < plan.senses.length; offset += 100) {
      const data = JSON.stringify(plan.senses.slice(offset, offset + 100));
      sensesAdded += (await client.query(`INSERT INTO thesaurus_senses(source,source_entry_id,sense_key,term,part_of_speech,definition,metadata,dictionary_entry_id)
        SELECT value->>'source',value->>'sourceEntryId',value->>'senseKey',value->>'term',value->>'partOfSpeech',value->>'definition',
          value->'metadata',(value->>'dictionaryEntryId')::uuid FROM jsonb_array_elements($1::jsonb)
        ON CONFLICT(source,source_entry_id,sense_key) DO NOTHING`, [data])).rowCount ?? 0;
      relationsAdded += (await client.query(`INSERT INTO thesaurus_relations(sense_id,target_term,kind,source_list,group_order,sort_order,metadata)
        SELECT s.id,r.value->>'term',r.value->>'kind',r.value->>'sourceList',(r.value->>'groupOrder')::int,(r.value->>'sortOrder')::int,r.value->'metadata'
        FROM jsonb_array_elements($1::jsonb) item
        JOIN thesaurus_senses s ON s.source=item->>'source' AND s.source_entry_id=item->>'sourceEntryId' AND s.sense_key=item->>'senseKey'
        CROSS JOIN LATERAL jsonb_array_elements(item->'relations') r(value)
        ON CONFLICT DO NOTHING`, [data])).rowCount ?? 0;
    }
    await client.query('COMMIT');
    return { sensesAdded, relationsAdded };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
