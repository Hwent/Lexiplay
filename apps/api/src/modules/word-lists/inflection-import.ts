import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Inflection, inflectionLabels } from './dictionary-inflections';

type Entry = { id: string; term: string; pos: string; definitions: string[] };
export type InflectionPlan = {
  version: string;
  links: (Inflection & { baseId: string; baseDefinitions: string[] })[];
  skipped: { link: Inflection; reason: string }[];
  newEntries: { term: string; partOfSpeech: string }[];
};

export async function planInflections(pool: Pool, input: Inflection[]): Promise<InflectionPlan> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const version = (await client.query('SELECT version FROM library_state WHERE id=1')).rows[0].version;
    const { rows } = await client.query<Entry>(`SELECT e.id,e.term,e.part_of_speech pos,
      COALESCE(array_agg(d.definition ORDER BY d.sense_order) FILTER(WHERE d.language_code='en'),'{}') definitions
      FROM dictionary_entries e LEFT JOIN dictionary_definitions d ON d.dictionary_entry_id=e.id GROUP BY e.id`);
    const exact = new Map(rows.map(row => [JSON.stringify([row.term, row.pos]), row]));
    const folded = new Map<string, Entry[]>();
    for (const row of rows) {
      const key = JSON.stringify([row.term.toLowerCase(), row.pos]);
      const matches = folded.get(key) ?? []; matches.push(row); folded.set(key, matches);
    }
    const links = new Map<string, InflectionPlan['links'][number]>(), skipped: InflectionPlan['skipped'] = [];
    const newEntries = new Map<string, { term: string; partOfSpeech: string }>();
    for (const link of input) {
      if (!Object.hasOwn(inflectionLabels, link.kind) || !link.form.trim() || link.form !== link.form.trim()
        || link.form.length > 100 || /[\u0000-\u001f\u007f]/.test(link.form)) throw new Error('Invalid inflection input.');
      const candidates = folded.get(JSON.stringify([link.base.toLowerCase(), link.partOfSpeech])) ?? [];
      const base = exact.get(JSON.stringify([link.base, link.partOfSpeech])) ?? (candidates.length === 1 ? candidates[0] : undefined);
      if (!base?.definitions.length) { skipped.push({ link, reason: 'No unambiguous base entry with matching part of speech and English definition.' }); continue; }
      if (base.term === link.form) continue;
      const baseDefinitions = link.source === 'merriam-webster-collegiate' && link.senseDefinitions?.length
        ? link.senseDefinitions.slice(0, 2) : base.definitions.slice(0, 2);
      const selected = { ...link, base: base.term, baseId: base.id, baseDefinitions };
      const key = JSON.stringify([base.id, link.form, link.kind]);
      // Explicit existing dictionary labels take priority over unlabelled API forms.
      if (!links.has(key)) links.set(key, selected);
      const formKey = JSON.stringify([link.form, link.partOfSpeech]);
      if (!exact.has(formKey)) newEntries.set(formKey, { term: link.form, partOfSpeech: link.partOfSpeech });
    }
    const typed = new Set([...links.values()].filter(link => link.kind !== 'verb_form').map(link => JSON.stringify([link.baseId, link.form])));
    const selected = [...links.values()].filter(link => link.kind !== 'verb_form' || !typed.has(JSON.stringify([link.baseId, link.form])));
    await client.query('COMMIT');
    return { version, links: selected.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en')),
      skipped, newEntries: [...newEntries.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en')) };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export const inflectionFingerprint = (plan: InflectionPlan) => createHash('sha256').update(JSON.stringify(plan)).digest('hex');

export async function applyInflections(pool: Pool, plan: InflectionPlan) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('library-publication',0))");
    const state = (await client.query('SELECT version FROM library_state WHERE id=1 FOR UPDATE')).rows[0];
    if (state.version !== plan.version) throw new Error('Dictionary changed. Generate a fresh inflection report.');
    let entriesAdded = 0, definitionsAdded = 0, linksAdded = 0;
    const meanings = new Map<string, Set<string>>();
    for (const link of plan.links) {
      const key = JSON.stringify([link.form, link.partOfSpeech]);
      const definitions = meanings.get(key) ?? new Set<string>();
      definitions.add(`${inflectionLabels[link.kind]} of ${link.base}. ${link.baseDefinitions.join('; ')}`);
      meanings.set(key, definitions);
    }
    for (let offset = 0; offset < plan.links.length; offset += 500) {
      const batch = plan.links.slice(offset, offset + 500);
      const data = JSON.stringify(batch);
      entriesAdded += (await client.query(`INSERT INTO dictionary_entries(term,part_of_speech,source_metadata)
        SELECT DISTINCT value->>'form',value->>'partOfSpeech','{"origin":"inflection-supplement"}'::jsonb
        FROM jsonb_array_elements($1::jsonb) ON CONFLICT(term,part_of_speech) DO NOTHING`, [data])).rowCount ?? 0;
      // Existing meanings (including non-English ones) remain intact.
      const definitions = new Map<string, string>();
      for (const link of batch) {
        const key = JSON.stringify([link.form, link.partOfSpeech]);
        definitions.set(key, [...meanings.get(key)!].join('\n'));
      }
      definitionsAdded += (await client.query(`INSERT INTO dictionary_definitions(dictionary_entry_id,language_code,sense_order,definition,source_label)
        SELECT e.id,'en',0,value->>'definition','lexiplay-inflection'
        FROM jsonb_array_elements($1::jsonb) JOIN dictionary_entries e ON e.term=value->>'term' AND e.part_of_speech=value->>'pos'
        WHERE NOT EXISTS(SELECT 1 FROM dictionary_definitions d WHERE d.dictionary_entry_id=e.id AND d.language_code='en')
        ON CONFLICT DO NOTHING`, [JSON.stringify([...definitions].map(([key, definition]) => {
          const [term, pos] = JSON.parse(key); return { term, pos, definition };
        }))])).rowCount ?? 0;
      linksAdded += (await client.query(`INSERT INTO dictionary_inflections(base_entry_id,form_entry_id,kind,source,source_ref)
        SELECT (value->>'baseId')::uuid,e.id,value->>'kind',value->>'source',value->>'sourceRef'
        FROM jsonb_array_elements($1::jsonb) JOIN dictionary_entries e ON e.term=value->>'form' AND e.part_of_speech=value->>'partOfSpeech'
        ON CONFLICT DO NOTHING`, [data])).rowCount ?? 0;
    }
    if (entriesAdded || definitionsAdded || linksAdded) await client.query('UPDATE library_state SET version=$1 WHERE id=1', [randomUUID()]);
    await client.query('COMMIT');
    return { entriesAdded, definitionsAdded, linksAdded };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
