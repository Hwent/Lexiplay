import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';

export type WordStatus = 'KNOWN' | 'UNFAMILIAR';
export type WordEntry = { id: string; term: string; definition: string; partOfSpeech: string | null; example: string | null; status: WordStatus };
export type WordList = { id: string; name: string; words: WordEntry[] };
type WordListRow = Omit<WordList, 'words'>;
export type DictionaryEntry = { term: string; definition?: string; partOfSpeech: string[] };

@Injectable()
export class WordListRepository implements OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://lexiplay:lexiplay@127.0.0.1:5432/lexiplay',
  });
  private schemaReady?: Promise<void>;

  async findAll(ownerId: string): Promise<WordList[]> {
    await this.ensureSchema();
    return [await this.ensureDefaultList(ownerId)];
  }

  async find(ownerId: string, id: string): Promise<WordList | null> {
    await this.ensureSchema();
    const { rows } = await this.pool.query<WordListRow>(
      'SELECT id, name FROM user_word_lists WHERE owner_id = $1 AND id = $2', [ownerId, id],
    );
    return rows[0] ? (await this.includeWords(rows))[0]! : null;
  }

  async searchDictionary(query: string, limit = 25): Promise<DictionaryEntry[]> {
    await this.ensureSchema();
    const normalized = query.trim().toLowerCase();
    const { rows } = await this.pool.query<DictionaryEntry>(
      `SELECT term, part_of_speech AS "partOfSpeech"
       FROM dictionary_words WHERE term LIKE $1 || '%' OR term = $2
       ORDER BY CASE WHEN term = $2 THEN 0 ELSE 1 END, term LIMIT $3`,
      [normalized, normalized, Math.min(limit, 10)],
    );
    return rows;
  }

  async getDictionaryDefinition(term: string): Promise<string> {
    await this.ensureSchema();
    const { rows } = await this.pool.query<{ definition: string }>(
      'SELECT definition FROM dictionary_words WHERE term = $1', [term.trim().toLowerCase()],
    );
    return rows[0]?.definition ?? '';
  }

  async addDictionaryWord(ownerId: string, listId: string, term: string): Promise<WordEntry | null> {
    await this.ensureSchema();
    const { rows } = await this.pool.query<WordEntry>(
      `INSERT INTO user_words (list_id, term, definition, part_of_speech, example)
       SELECT lists.id, dictionary.term,
              CASE WHEN char_length(dictionary.definition) > 500
                THEN left(dictionary.definition, 499) || '…'
                ELSE dictionary.definition
              END,
              dictionary.part_of_speech[1], NULL
       FROM user_word_lists AS lists CROSS JOIN dictionary_words AS dictionary
       WHERE lists.owner_id = $1 AND lists.id = $2 AND dictionary.term = $3
       ON CONFLICT (list_id, term) DO UPDATE SET term = EXCLUDED.term
       RETURNING id, term, definition, part_of_speech AS "partOfSpeech", example, status`,
      [ownerId, listId, term],
    );
    return rows[0] ?? null;
  }

  async addWord(ownerId: string, listId: string, word: Omit<WordEntry, 'id' | 'status'>): Promise<WordEntry | null> {
    await this.ensureSchema();
    const { rows } = await this.pool.query<WordEntry>(
      `INSERT INTO user_words (list_id, term, definition, part_of_speech, example)
       SELECT id, $3, $4, $5, $6 FROM user_word_lists WHERE owner_id = $1 AND id = $2
       RETURNING id, term, definition, part_of_speech AS "partOfSpeech", example, status`,
      [ownerId, listId, word.term, word.definition, word.partOfSpeech, word.example],
    );
    return rows[0] ?? null;
  }

  async importWords(ownerId: string, listId: string, words: Omit<WordEntry, 'id' | 'status'>[]): Promise<{ added: number; duplicates: number }> {
    await this.ensureSchema();
    if (!words.length) return { added: 0, duplicates: 0 };
    const terms = words.map(word => word.term);
    const definitions = words.map(word => word.definition);
    const partsOfSpeech = words.map(word => word.partOfSpeech);
    const examples = words.map(word => word.example);
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO user_words (list_id, term, definition, part_of_speech, example)
       SELECT lists.id, incoming.term, incoming.definition, incoming.part_of_speech, incoming.example
       FROM user_word_lists AS lists
       CROSS JOIN UNNEST($3::text[], $4::text[], $5::text[], $6::text[])
         AS incoming(term, definition, part_of_speech, example)
       WHERE lists.owner_id = $1 AND lists.id = $2
       ON CONFLICT (list_id, term) DO NOTHING
       RETURNING id`,
      [ownerId, listId, terms, definitions, partsOfSpeech, examples],
    );
    return { added: rows.length, duplicates: words.length - rows.length };
  }

  async updateWord(ownerId: string, listId: string, wordId: string, patch: Partial<Omit<WordEntry, 'id'>>): Promise<WordEntry | null> {
    await this.ensureSchema();
    const { rowCount } = await this.pool.query(
      `UPDATE user_words AS words SET
       term = COALESCE($4, words.term), definition = COALESCE($5, words.definition),
       part_of_speech = CASE WHEN $6 THEN $7 ELSE words.part_of_speech END,
       example = CASE WHEN $8 THEN $9 ELSE words.example END,
       status = COALESCE($10, words.status),
       updated_at = now()
       FROM user_word_lists AS lists
       WHERE words.id = $3 AND words.list_id = lists.id AND lists.owner_id = $1 AND lists.id = $2`,
      [ownerId, listId, wordId, patch.term ?? null, patch.definition ?? null,
        patch.partOfSpeech !== undefined, patch.partOfSpeech ?? null, patch.example !== undefined, patch.example ?? null, patch.status ?? null],
    );
    if (!rowCount) return null;
    const { rows } = await this.pool.query<WordEntry>(
      `SELECT words.id, words.term, words.definition, words.part_of_speech AS "partOfSpeech", words.example, words.status
       FROM user_words AS words WHERE words.id = $1`, [wordId],
    );
    return rows[0] ?? null;
  }

  async removeWord(ownerId: string, listId: string, wordId: string): Promise<boolean> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `DELETE FROM user_words AS words USING user_word_lists AS lists
       WHERE words.id = $3 AND words.list_id = lists.id AND lists.owner_id = $1 AND lists.id = $2`,
      [ownerId, listId, wordId],
    );
    return Boolean(result.rowCount);
  }

  async onModuleDestroy() { await this.pool.end(); }

  private async includeWords(rows: WordListRow[]): Promise<WordList[]> {
    if (!rows.length) return [];
    const ids = rows.map(row => row.id);
    const { rows: words } = await this.pool.query<WordEntry & { listId: string }>(
      `SELECT id, list_id AS "listId", term, definition, part_of_speech AS "partOfSpeech", example, status
       FROM user_words WHERE list_id = ANY($1::uuid[]) ORDER BY created_at`, [ids],
    );
    return rows.map(row => ({ ...row, words: words.filter(word => word.listId === row.id).map(({ listId: _listId, ...word }) => word) }));
  }

  private ensureSchema(): Promise<void> {
    this.schemaReady ??= this.pool.query(`
      CREATE TABLE IF NOT EXISTS user_word_lists (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
        name varchar(60) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS user_word_lists_owner_created_idx ON user_word_lists(owner_id, created_at DESC);
      ALTER TABLE user_word_lists DROP COLUMN IF EXISTS description;
      CREATE TABLE IF NOT EXISTS user_words (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        list_id uuid NOT NULL REFERENCES user_word_lists(id) ON DELETE CASCADE,
        term varchar(100) NOT NULL CHECK (term ~ '^[a-z][a-z ''-]{0,99}$'),
        definition varchar(500) NOT NULL DEFAULT '',
        part_of_speech varchar(40),
        example varchar(500),
        status varchar(16) NOT NULL DEFAULT 'UNFAMILIAR' CHECK (status IN ('KNOWN', 'UNFAMILIAR')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (list_id, term)
      );
      ALTER TABLE user_words ALTER COLUMN definition TYPE varchar(500)
        USING CASE WHEN char_length(definition) > 500 THEN left(definition, 499) || '…' ELSE definition END;
      UPDATE user_words SET definition = substring(definition FROM '^(([^;]*;){2})') WHERE definition ~ '^[^;]*;[^;]*;';
      ALTER TABLE user_words ALTER COLUMN term TYPE varchar(100);
      ALTER TABLE user_words DROP CONSTRAINT IF EXISTS user_words_term_check;
      ALTER TABLE user_words ADD CONSTRAINT user_words_term_check CHECK (term ~ '^[a-z][a-z ''-]{0,99}$');
      ALTER TABLE user_words ADD COLUMN IF NOT EXISTS status varchar(16) NOT NULL DEFAULT 'UNFAMILIAR';
      ALTER TABLE user_words DROP CONSTRAINT IF EXISTS user_words_status_check;
      ALTER TABLE user_words ADD CONSTRAINT user_words_status_check CHECK (status IN ('KNOWN', 'UNFAMILIAR'));
      CREATE INDEX IF NOT EXISTS user_words_list_created_idx ON user_words(list_id, created_at);
      CREATE TABLE IF NOT EXISTS dictionary_words (
        term varchar(100) PRIMARY KEY,
        definition text NOT NULL,
        part_of_speech text[] NOT NULL DEFAULT '{}',
        source varchar(80) NOT NULL DEFAULT 'Simple English Wiktionary'
      );
      CREATE INDEX IF NOT EXISTS dictionary_words_term_prefix_idx ON dictionary_words(term text_pattern_ops);
      UPDATE dictionary_words SET definition = substring(definition FROM '^(([^;]*;){2})') WHERE definition ~ '^[^;]*;[^;]*;';
      WITH ranked AS (
        SELECT id, first_value(id) OVER (PARTITION BY owner_id ORDER BY created_at, id) AS keep_id,
               row_number() OVER (PARTITION BY owner_id ORDER BY created_at, id) AS list_rank
        FROM user_word_lists
      ), word_ranked AS (
        SELECT words.id, ranked.keep_id,
               row_number() OVER (PARTITION BY ranked.keep_id, lower(words.term) ORDER BY (words.list_id = ranked.keep_id) DESC, words.created_at, words.id) AS word_rank
        FROM user_words AS words JOIN ranked ON ranked.id = words.list_id
      )
      DELETE FROM user_words WHERE id IN (SELECT id FROM word_ranked WHERE word_rank > 1);
      WITH ranked AS (
        SELECT id, first_value(id) OVER (PARTITION BY owner_id ORDER BY created_at, id) AS keep_id,
               row_number() OVER (PARTITION BY owner_id ORDER BY created_at, id) AS list_rank
        FROM user_word_lists
      )
      UPDATE user_words AS words SET list_id = ranked.keep_id FROM ranked WHERE words.list_id = ranked.id AND ranked.list_rank > 1;
      WITH ranked AS (
        SELECT id, row_number() OVER (PARTITION BY owner_id ORDER BY created_at, id) AS list_rank FROM user_word_lists
      ) DELETE FROM user_word_lists WHERE id IN (SELECT id FROM ranked WHERE list_rank > 1);
      CREATE UNIQUE INDEX IF NOT EXISTS user_word_lists_one_per_owner_idx ON user_word_lists(owner_id);
    `).then(() => undefined);
    return this.schemaReady;
  }

  private async ensureDefaultList(ownerId: string): Promise<WordList> {
    const { rows } = await this.pool.query<WordListRow>(
      "INSERT INTO user_word_lists (owner_id, name) VALUES ($1, 'My words') ON CONFLICT (owner_id) DO UPDATE SET name = 'My words' RETURNING id, name",
      [ownerId],
    );
    return (await this.includeWords(rows))[0]!;
  }
}
