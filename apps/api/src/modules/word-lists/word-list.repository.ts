import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

export type WordStatus = 'KNOWN' | 'UNFAMILIAR';
export type WordEntry = { id: string; term: string; definition: string; partOfSpeech: string | null; status: WordStatus };
export type WordList = { id: string; name: string; words: WordEntry[] };
export type DictionarySense = { id: string; partOfSpeech: string; definitions: string[] };
export type DictionaryEntry = { id: string; term: string; definition?: string; partOfSpeech: string[]; senses: DictionarySense[] };

const sensesSql = `SELECT jsonb_agg(jsonb_build_object('id',e.id,'partOfSpeech',e.part_of_speech,'definitions',e.definitions) ORDER BY e.part_of_speech) AS senses
  FROM (SELECT e.id,e.part_of_speech,array_agg(d.definition ORDER BY d.sense_order) AS definitions
    FROM dictionary_entries e JOIN dictionary_definitions d ON d.dictionary_entry_id=e.id
    WHERE e.word_id=w.id AND e.retired_at IS NULL GROUP BY e.id,e.part_of_speech) e`;

@Injectable()
export class WordListRepository implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgresql://lexiplay:lexiplay@127.0.0.1:5432/lexiplay' });

  async searchDictionary(query: string, limit = 10): Promise<DictionaryEntry[]> {
    const { rows } = await this.pool.query<{ id: string; term: string; senses: DictionarySense[] }>(
      `SELECT w.id,w.term,s.senses FROM dictionary_words w CROSS JOIN LATERAL (${sensesSql}) s
       WHERE w.retired_at IS NULL AND s.senses IS NOT NULL AND lower(w.term COLLATE "default") LIKE lower($1) || '%'
       ORDER BY (w.term=$1) DESC,w.term LIMIT $2`, [query.trim(), Math.min(limit, 25)]);
    return rows.map(row => ({ ...row, partOfSpeech: row.senses.map(sense => sense.partOfSpeech),
      definition: row.senses.map(sense => sense.definitions.join('; ')).join('\n') }));
  }

  async getDictionaryDefinition(term: string): Promise<string> {
    const result = await this.pool.query<{ definition: string }>(`SELECT string_agg(d.definition,'; ' ORDER BY e.part_of_speech,d.sense_order) AS definition
      FROM dictionary_words w JOIN dictionary_entries e ON e.word_id=w.id AND e.retired_at IS NULL
      JOIN dictionary_definitions d ON d.dictionary_entry_id=e.id
      WHERE w.retired_at IS NULL AND w.id=(SELECT id FROM dictionary_words WHERE retired_at IS NULL AND lower(term COLLATE "default")=lower($1)
        ORDER BY (term=$1) DESC,term LIMIT 1)`, [term.trim()]);
    return result.rows[0]?.definition ?? '';
  }

  async poolDictionaryEntries(terms: string[]): Promise<DictionaryEntry[]> {
    if (!terms.length) return [];
    const { rows } = await this.pool.query<{ id: string; term: string; senses: DictionarySense[] }>(`SELECT w.id,w.term,s.senses
      FROM unnest($1::text[]) requested(term)
      CROSS JOIN LATERAL (SELECT * FROM dictionary_words WHERE retired_at IS NULL AND lower(term COLLATE "default")=lower(requested.term)
        ORDER BY (term=requested.term) DESC,term LIMIT 1) w
      CROSS JOIN LATERAL (${sensesSql}) s WHERE s.senses IS NOT NULL`, [terms]);
    return rows.map(row => ({ ...row, partOfSpeech: row.senses.map(sense => sense.partOfSpeech) }));
  }

  async dictionaryGameWords(length: number): Promise<string[]> {
    const { rows } = await this.pool.query<{ term: string }>(`SELECT DISTINCT lower(w.term) AS term FROM dictionary_words w
      WHERE w.retired_at IS NULL AND char_length(w.term)=$1 AND lower(w.term) ~ '^[a-z]+$'
      AND EXISTS(SELECT 1 FROM dictionary_entries e JOIN dictionary_definitions d ON d.dictionary_entry_id=e.id WHERE e.word_id=w.id AND e.retired_at IS NULL)
      ORDER BY term`, [length]);
    return rows.map(row => row.term);
  }

  async mergeGuestWords(client: PoolClient, userId: string, words: Omit<WordEntry, 'id'>[]) {
    if (!words.length) return { wordsAdded: 0, wordsAlreadySaved: 0 };
    const matches = await client.query<{ id: string }>(`SELECT DISTINCT e.id FROM jsonb_array_elements($1::jsonb) incoming
      JOIN LATERAL (SELECT id FROM dictionary_words w WHERE w.retired_at IS NULL AND
        (w.term=incoming->>'term' OR (lower(w.term COLLATE "default")=lower(incoming->>'term')
          AND (SELECT count(*) FROM dictionary_words x WHERE x.retired_at IS NULL AND lower(x.term COLLATE "default")=lower(incoming->>'term'))=1))
        ORDER BY (w.term=incoming->>'term') DESC LIMIT 1) w ON true
      JOIN dictionary_entries e ON e.word_id=w.id AND e.retired_at IS NULL
      WHERE (incoming->>'partOfSpeech' IS NULL OR incoming->>'partOfSpeech'='' OR e.part_of_speech=incoming->>'partOfSpeech')
      AND EXISTS(SELECT 1 FROM dictionary_definitions d WHERE d.dictionary_entry_id=e.id)`, [JSON.stringify(words)]);
    const ids = matches.rows.map(row => row.id);
    const added = await client.query(`INSERT INTO user_words(user_id,dictionary_entry_id) SELECT $1,unnest($2::uuid[])
      ON CONFLICT(user_id,dictionary_entry_id) DO NOTHING RETURNING id`, [userId, ids]);
    return { wordsAdded: added.rowCount ?? 0, wordsAlreadySaved: ids.length - (added.rowCount ?? 0) };
  }

  async onModuleDestroy() { await this.pool.end(); }
}
