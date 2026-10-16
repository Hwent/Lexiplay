import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

export type WordStatus = 'KNOWN' | 'UNFAMILIAR';
export type WordEntry = { id: string; term: string; definition: string; partOfSpeech: string | null; status: WordStatus };
export type WordList = { id: string; name: string; words: WordEntry[] };
export type DictionarySense = { id: string; partOfSpeech: string; definitions: string[] };
export type DictionaryEntry = { id: string; term: string; definition?: string; partOfSpeech: string[]; senses: DictionarySense[] };

const sensesSql = `SELECT jsonb_agg(jsonb_build_object('id',e.id,'partOfSpeech',e.part_of_speech,'definitions',e.definitions) ORDER BY e.part_of_speech) AS senses
  FROM (SELECT e.id,e.part_of_speech,array_agg(d.definition ORDER BY d.sense_order) AS definitions
    FROM dictionary_entries e JOIN dictionary_definitions d ON d.dictionary_entry_id=e.id AND d.language_code='en'
    WHERE e.term=w.term GROUP BY e.id,e.part_of_speech) e`;

@Injectable()
export class WordListRepository implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgresql://lexiplay:lexiplay@127.0.0.1:5432/lexiplay' });

  async searchDictionary(query: string, limit = 10): Promise<DictionaryEntry[]> {
    const { rows } = await this.pool.query<{ id: string; term: string; senses: DictionarySense[] }>(
      `SELECT w.term AS id,w.term,s.senses FROM
        (SELECT term FROM dictionary_entries WHERE lower(term COLLATE "default") LIKE lower($1) || '%'
         GROUP BY term ORDER BY (term=$1) DESC,term LIMIT $2) w CROSS JOIN LATERAL (${sensesSql}) s
       WHERE s.senses IS NOT NULL ORDER BY (w.term=$1) DESC,w.term LIMIT $2`, [query.trim(), Math.min(limit, 25)]);
    return rows.map(row => ({ ...row, partOfSpeech: row.senses.map(sense => sense.partOfSpeech),
      definition: row.senses.map(sense => sense.definitions.join('; ')).join('\n') }));
  }

  async getDictionaryDefinition(term: string): Promise<string> {
    const result = await this.pool.query<{ definition: string }>(`SELECT string_agg(d.definition,'; ' ORDER BY e.part_of_speech,d.sense_order) AS definition
      FROM dictionary_entries e JOIN dictionary_definitions d ON d.dictionary_entry_id=e.id AND d.language_code='en'
      WHERE e.term=(SELECT term FROM dictionary_entries WHERE lower(term COLLATE "default")=lower($1)
        ORDER BY (term=$1) DESC,term LIMIT 1)`, [term.trim()]);
    return result.rows[0]?.definition ?? '';
  }

  async poolDictionaryEntries(terms: string[]): Promise<DictionaryEntry[]> {
    if (!terms.length) return [];
    const { rows } = await this.pool.query<{ id: string; term: string; senses: DictionarySense[] }>(`SELECT w.term AS id,w.term,s.senses
      FROM unnest($1::text[]) requested(term)
      CROSS JOIN LATERAL (SELECT term FROM dictionary_entries WHERE lower(term COLLATE "default")=lower(requested.term)
        ORDER BY (term=requested.term) DESC,term LIMIT 1) w
      CROSS JOIN LATERAL (${sensesSql}) s WHERE s.senses IS NOT NULL`, [terms]);
    return rows.map(row => ({ ...row, partOfSpeech: row.senses.map(sense => sense.partOfSpeech) }));
  }

  async dictionaryGameWords(length: number, maxLength = length): Promise<string[]> {
    const { rows } = await this.pool.query<{ term: string }>(`SELECT DISTINCT e.term FROM dictionary_entries e
      WHERE char_length(e.term) BETWEEN $1 AND $2 AND e.term ~ '^[a-z]+$'
      AND e.part_of_speech NOT IN ('proper noun','proper_noun','name')
      AND EXISTS(SELECT 1 FROM dictionary_definitions d WHERE d.dictionary_entry_id=e.id AND d.language_code='en')
      ORDER BY term`, [length, maxLength]);
    return rows.map(row => row.term);
  }

  async isDictionaryGameWord(term: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ valid: boolean }>(`SELECT EXISTS(
      SELECT 1 FROM dictionary_entries e WHERE e.term=$1
      AND e.part_of_speech NOT IN ('proper noun','proper_noun','name')
      AND EXISTS(SELECT 1 FROM dictionary_definitions d WHERE d.dictionary_entry_id=e.id AND d.language_code='en')
    ) AS valid`, [term]);
    return rows[0]!.valid;
  }

  async mergeGuestWords(client: PoolClient, userId: string, words: Omit<WordEntry, 'id'>[]) {
    if (!words.length) return { wordsAdded: 0, wordsAlreadySaved: 0 };
    const matches = await client.query<{ id: string }>(`SELECT DISTINCT e.id FROM jsonb_array_elements($1::jsonb) incoming
      JOIN LATERAL (SELECT term FROM dictionary_entries w WHERE
        (w.term=incoming->>'term' OR (lower(w.term COLLATE "default")=lower(incoming->>'term')
          AND (SELECT count(DISTINCT x.term) FROM dictionary_entries x WHERE lower(x.term COLLATE "default")=lower(incoming->>'term'))=1))
        ORDER BY (w.term=incoming->>'term') DESC LIMIT 1) w ON true
      JOIN dictionary_entries e ON e.term=w.term
      WHERE (incoming->>'partOfSpeech' IS NULL OR incoming->>'partOfSpeech'='' OR e.part_of_speech=incoming->>'partOfSpeech')
      AND EXISTS(SELECT 1 FROM dictionary_definitions d WHERE d.dictionary_entry_id=e.id AND d.language_code='en')`, [JSON.stringify(words)]);
    const ids = matches.rows.map(row => row.id);
    const added = await client.query(`INSERT INTO user_words(user_id,dictionary_entry_id) SELECT $1,unnest($2::uuid[])
      ON CONFLICT(user_id,dictionary_entry_id) DO NOTHING RETURNING id`, [userId, ids]);
    return { wordsAdded: added.rowCount ?? 0, wordsAlreadySaved: ids.length - (added.rowCount ?? 0) };
  }

  async onModuleDestroy() { await this.pool.end(); }
}
