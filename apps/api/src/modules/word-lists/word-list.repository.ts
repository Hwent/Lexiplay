import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

export type WordStatus = 'KNOWN' | 'UNFAMILIAR';
export type WordEntry = { id: string; term: string; definition: string; partOfSpeech: string | null; status: WordStatus };
export type WordList = { id: string; name: string; words: WordEntry[] };
type WordListRow = Omit<WordList, 'words'>;
export type DictionaryEntry = { term: string; definition?: string; partOfSpeech: string[]; senses?: { partOfSpeech: string; definitions: string[] }[] };

@Injectable()
export class WordListRepository implements OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://lexiplay:lexiplay@127.0.0.1:5432/lexiplay',
  });
  private schemaReady?: Promise<void>;
  private dictionarySchemaReady?: Promise<void>;

  async findAll(ownerId: string): Promise<WordList[]> {
    await this.ensureSchema();
    return [await this.ensureDefaultList(ownerId)];
  }
  async ensurePersonalList(ownerId: string): Promise<void> {
    await this.ensureSchema();
    const existing = await this.pool.query('SELECT id FROM user_word_lists WHERE owner_id=$1 AND is_default LIMIT 1', [ownerId]);
    if (existing.rowCount) return;
    await this.pool.query("INSERT INTO user_word_lists(owner_id,name,is_default) VALUES ($1,'My words',true) ON CONFLICT(owner_id) WHERE is_default DO NOTHING", [ownerId]);
  }

  async find(ownerId: string, id: string): Promise<WordList | null> {
    await this.ensureSchema();
    const { rows } = await this.pool.query<WordListRow>(
      'SELECT id, name FROM user_word_lists WHERE owner_id = $1 AND id = $2', [ownerId, id],
    );
    return rows[0] ? (await this.includeWords(rows))[0]! : null;
  }

  async searchDictionary(query: string, limit = 25): Promise<DictionaryEntry[]> {
    await this.ensureDictionarySchema();
    const normalized = query.trim().toLowerCase();
    const { rows } = await this.pool.query<DictionaryEntry>(
      `SELECT term, part_of_speech AS "partOfSpeech", senses
       FROM dictionary_words WHERE lower(term) LIKE $1 || '%' OR term = $2
       ORDER BY CASE WHEN term = $2 THEN 0 ELSE 1 END, term LIMIT $3`,
      [normalized, normalized, Math.min(limit, 10)],
    );
    return rows;
  }

  async getDictionaryDefinition(term: string): Promise<string> {
    await this.ensureDictionarySchema();
    const { rows } = await this.pool.query<{ definition: string }>(
      'SELECT definition FROM dictionary_words WHERE lower(term) = lower($1) ORDER BY (term = $1) DESC, term LIMIT 1', [term.trim()],
    );
    return rows[0]?.definition ?? '';
  }

  async poolDictionaryEntries(terms: string[]) {
    await this.ensureDictionarySchema();
    const { rows } = await this.pool.query<{ term: string; senses: { partOfSpeech: string; definitions: string[] }[] }>(
      `SELECT DISTINCT ON (lower(term)) lower(term) AS term, senses FROM dictionary_words
       WHERE lower(term)=ANY($1::text[]) ORDER BY lower(term), (term=lower(term)) DESC, (btrim(definition)<>'') DESC, term`, [terms]);
    return rows;
  }

  async dictionaryGameWords(wordLength: number): Promise<string[]> {
    await this.ensureDictionarySchema();
    const { rows } = await this.pool.query<{ term: string }>(
      `SELECT DISTINCT lower(term) AS term FROM dictionary_words
       WHERE char_length(term) = $1 AND lower(term) ~ '^[a-z]+$' AND btrim(definition) <> ''
       ORDER BY term`, [wordLength],
    );
    return rows.map(row => row.term);
  }

  async addDictionaryWord(ownerId: string, listId: string, term: string): Promise<WordEntry | null> {
    await this.ensureSchema();
    const { rows } = await this.pool.query<WordEntry>(
      `INSERT INTO user_words (list_id, term, definition, part_of_speech)
       SELECT lists.id, lower(dictionary.term),
              CASE WHEN char_length(dictionary.definition) > 500
                THEN left(dictionary.definition, 499) || '…'
                ELSE dictionary.definition
              END,
              array_to_string(dictionary.part_of_speech, ', ')
       FROM user_word_lists AS lists CROSS JOIN dictionary_words AS dictionary
       WHERE lists.owner_id = $1 AND lists.id = $2 AND lower(dictionary.term) = lower($3)
       ORDER BY (dictionary.term = $3) DESC, dictionary.term LIMIT 1
       ON CONFLICT (list_id, term) DO UPDATE SET term = EXCLUDED.term
       RETURNING id, term, definition, part_of_speech AS "partOfSpeech", status`,
      [ownerId, listId, term],
    );
    return rows[0] ?? null;
  }

  async addWord(ownerId: string, listId: string, word: Omit<WordEntry, 'id' | 'status'>): Promise<WordEntry | null> {
    await this.ensureSchema();
    const { rows } = await this.pool.query<WordEntry>(
      `INSERT INTO user_words (list_id, term, definition, part_of_speech)
       SELECT id, $3, $4, $5 FROM user_word_lists WHERE owner_id = $1 AND id = $2
       RETURNING id, term, definition, part_of_speech AS "partOfSpeech", status`,
      [ownerId, listId, word.term, word.definition, word.partOfSpeech],
    );
    return rows[0] ?? null;
  }

  async importWords(ownerId: string, listId: string, words: Omit<WordEntry, 'id' | 'status'>[]): Promise<{ added: number; duplicates: number }> {
    await this.ensureSchema();
    if (!words.length) return { added: 0, duplicates: 0 };
    const terms = words.map(word => word.term);
    const definitions = words.map(word => word.definition);
    const partsOfSpeech = words.map(word => word.partOfSpeech);
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO user_words (list_id, term, definition, part_of_speech)
       SELECT lists.id, incoming.term, incoming.definition, incoming.part_of_speech
       FROM user_word_lists AS lists
       CROSS JOIN UNNEST($3::text[], $4::text[], $5::text[])
         AS incoming(term, definition, part_of_speech)
       WHERE lists.owner_id = $1 AND lists.id = $2
       ON CONFLICT (list_id, term) DO NOTHING
       RETURNING id`,
      [ownerId, listId, terms, definitions, partsOfSpeech],
    );
    return { added: rows.length, duplicates: words.length - rows.length };
  }

  async updateWord(ownerId: string, listId: string, wordId: string, patch: Partial<Omit<WordEntry, 'id'>>): Promise<WordEntry | null> {
    await this.ensureSchema();
    const { rowCount } = await this.pool.query(
      `UPDATE user_words AS words SET
       term = COALESCE($4, words.term), definition = COALESCE($5, words.definition),
       part_of_speech = CASE WHEN $6 THEN $7 ELSE words.part_of_speech END,
       status = COALESCE($8, words.status),
       updated_at = now()
       FROM user_word_lists AS lists
       WHERE words.id = $3 AND words.list_id = lists.id AND lists.owner_id = $1 AND lists.id = $2`,
      [ownerId, listId, wordId, patch.term ?? null, patch.definition ?? null,
        patch.partOfSpeech !== undefined, patch.partOfSpeech ?? null, patch.status ?? null],
    );
    if (!rowCount) return null;
    const { rows } = await this.pool.query<WordEntry>(
      `SELECT words.id, words.term, words.definition, words.part_of_speech AS "partOfSpeech", words.status
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

  prepareProgressTransfer() { return this.ensureSchema(); }

  async mergeGuestWords(client: PoolClient, ownerId: string, words: Omit<WordEntry, 'id'>[]) {
    if (!words.length) return { wordsAdded: 0, wordsAlreadySaved: 0 };
    const list = await client.query<{ id: string }>("INSERT INTO user_word_lists (owner_id, name, is_default) VALUES ($1, 'My words', true) ON CONFLICT (owner_id) WHERE is_default DO UPDATE SET is_default = true RETURNING id", [ownerId]);
    const added = await client.query(`INSERT INTO user_words (list_id, term, definition, part_of_speech, status)
      SELECT $1, incoming.term, incoming.definition, incoming.part_of_speech, incoming.status
      FROM UNNEST($2::text[], $3::text[], $4::text[], $5::text[]) AS incoming(term, definition, part_of_speech, status)
      ON CONFLICT (list_id, term) DO NOTHING RETURNING id`,
    [list.rows[0]!.id, words.map(word => word.term), words.map(word => word.definition), words.map(word => word.partOfSpeech), words.map(word => word.status)]);
    return { wordsAdded: added.rowCount ?? 0, wordsAlreadySaved: words.length - (added.rowCount ?? 0) };
  }

  private async includeWords(rows: WordListRow[]): Promise<WordList[]> {
    if (!rows.length) return [];
    const ids = rows.map(row => row.id);
    const { rows: words } = await this.pool.query<WordEntry & { listId: string }>(
      `SELECT id, list_id AS "listId", term, definition, part_of_speech AS "partOfSpeech", status
       FROM user_words WHERE list_id = ANY($1::uuid[]) ORDER BY created_at`, [ids],
    );
    return rows.map(row => ({ ...row, words: words.filter(word => word.listId === row.id).map(({ listId: _listId, ...word }) => word) }));
  }

  private ensureSchema(): Promise<void> {
    this.schemaReady ??= this.ensureDictionarySchema().then(() => this.pool.query(`
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
        term varchar(100) NOT NULL CHECK (btrim(term) <> ''),
        definition varchar(500) NOT NULL DEFAULT '',
        part_of_speech varchar(40),
        status varchar(16) NOT NULL DEFAULT 'UNFAMILIAR' CHECK (status IN ('KNOWN', 'UNFAMILIAR')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (list_id, term)
      );
      ALTER TABLE user_words DROP COLUMN IF EXISTS example;
      ALTER TABLE user_words ALTER COLUMN part_of_speech TYPE text;
      ALTER TABLE user_words ALTER COLUMN definition TYPE text;
      ALTER TABLE user_words ALTER COLUMN term TYPE varchar(100);
      ALTER TABLE user_words DROP CONSTRAINT IF EXISTS user_words_term_check;
      ALTER TABLE user_words ADD CONSTRAINT user_words_term_check CHECK (btrim(term) <> '');
      ALTER TABLE user_words ADD COLUMN IF NOT EXISTS status varchar(16) NOT NULL DEFAULT 'UNFAMILIAR';
      ALTER TABLE user_words DROP CONSTRAINT IF EXISTS user_words_status_check;
      ALTER TABLE user_words ADD CONSTRAINT user_words_status_check CHECK (status IN ('KNOWN', 'UNFAMILIAR'));
      CREATE INDEX IF NOT EXISTS user_words_list_created_idx ON user_words(list_id, created_at);
      ALTER TABLE user_word_lists ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;
      ALTER TABLE user_word_lists ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'en';
      WITH ranked AS (SELECT id, row_number() OVER(PARTITION BY owner_id ORDER BY created_at,id) AS rank FROM user_word_lists)
      UPDATE user_word_lists AS lists SET is_default=true FROM ranked WHERE lists.id=ranked.id AND ranked.rank=1
        AND NOT EXISTS(SELECT 1 FROM user_word_lists existing WHERE existing.owner_id=lists.owner_id AND existing.is_default);
      DROP INDEX IF EXISTS user_word_lists_one_per_owner_idx;
      CREATE UNIQUE INDEX IF NOT EXISTS user_word_lists_default_per_owner_idx ON user_word_lists(owner_id) WHERE is_default;
      ALTER TABLE user_words ADD COLUMN IF NOT EXISTS learning_stage text NOT NULL DEFAULT 'Core';
      ALTER TABLE user_words ADD COLUMN IF NOT EXISTS custom_language text;
      ALTER TABLE user_words ADD COLUMN IF NOT EXISTS familiarity integer NOT NULL DEFAULT 0;
      ALTER TABLE user_words ADD COLUMN IF NOT EXISTS next_review_at timestamptz;
    `)).then(() => undefined);
    return this.schemaReady;
  }

  private ensureDictionarySchema(): Promise<void> {
    this.dictionarySchemaReady ??= this.pool.query(`
      CREATE TABLE IF NOT EXISTS dictionary_words (
        term text PRIMARY KEY,
        definition text NOT NULL,
        part_of_speech text[] NOT NULL DEFAULT '{}'
      );
      ALTER TABLE dictionary_words DROP COLUMN IF EXISTS source;
      ALTER TABLE dictionary_words ALTER COLUMN term TYPE text;
      ALTER TABLE dictionary_words ADD COLUMN IF NOT EXISTS senses jsonb NOT NULL DEFAULT '[]';
      CREATE INDEX IF NOT EXISTS dictionary_words_lower_term_prefix_idx ON dictionary_words(lower(term) text_pattern_ops);
      CREATE INDEX IF NOT EXISTS dictionary_words_term_prefix_idx ON dictionary_words(term text_pattern_ops);
    `).then(() => undefined);
    return this.dictionarySchemaReady;
  }

  private async ensureDefaultList(ownerId: string): Promise<WordList> {
    const { rows } = await this.pool.query<WordListRow>(
      "INSERT INTO user_word_lists (owner_id, name, is_default) VALUES ($1, 'My words', true) ON CONFLICT (owner_id) WHERE is_default DO UPDATE SET is_default = true RETURNING id, name",
      [ownerId],
    );
    return (await this.includeWords(rows))[0]!;
  }
}
