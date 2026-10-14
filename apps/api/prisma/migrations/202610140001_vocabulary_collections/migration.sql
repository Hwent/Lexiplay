CREATE TABLE IF NOT EXISTS account_users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email varchar(254) UNIQUE,
 password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), username text, email_verified boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS user_word_lists (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
 name varchar(60) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_word_lists ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;
ALTER TABLE user_word_lists ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'en';
WITH ranked AS (SELECT id, row_number() OVER(PARTITION BY owner_id ORDER BY created_at,id) AS rank FROM user_word_lists)
 UPDATE user_word_lists AS lists SET is_default=true FROM ranked WHERE lists.id=ranked.id AND ranked.rank=1
 AND NOT EXISTS(SELECT 1 FROM user_word_lists existing WHERE existing.owner_id=lists.owner_id AND existing.is_default);
DROP INDEX IF EXISTS user_word_lists_one_per_owner_idx;
CREATE UNIQUE INDEX IF NOT EXISTS user_word_lists_default_per_owner_idx ON user_word_lists(owner_id) WHERE is_default;
CREATE TABLE dictionary_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lemma text NOT NULL,normalized_lemma text NOT NULL,part_of_speech text NOT NULL,
 UNIQUE(normalized_lemma,part_of_speech)
);
CREATE TABLE dictionary_definitions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),dictionary_entry_id uuid NOT NULL REFERENCES dictionary_entries(id) ON DELETE CASCADE,
 language text NOT NULL,sense_index integer NOT NULL DEFAULT 0,definition text NOT NULL,source text NOT NULL,
 review_status text NOT NULL DEFAULT 'pending',UNIQUE(dictionary_entry_id,language,sense_index)
);
CREATE TABLE vocabulary_collections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text UNIQUE NOT NULL,name text NOT NULL,description text NOT NULL,
 category text NOT NULL,level text,author text,source text,license text,version text NOT NULL,status text NOT NULL DEFAULT 'available'
);
CREATE TABLE collection_entries (
 collection_id uuid NOT NULL REFERENCES vocabulary_collections(id) ON DELETE CASCADE,
 dictionary_entry_id uuid NOT NULL REFERENCES dictionary_entries(id) ON DELETE RESTRICT,
 stage text NOT NULL DEFAULT 'Core',sort_order integer NOT NULL,PRIMARY KEY(collection_id,dictionary_entry_id)
);
CREATE INDEX collection_entries_sort_idx ON collection_entries(collection_id,sort_order);
CREATE TABLE word_list_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),word_list_id uuid NOT NULL REFERENCES user_word_lists(id) ON DELETE CASCADE,
 dictionary_entry_id uuid NOT NULL REFERENCES dictionary_entries(id) ON DELETE RESTRICT,custom_definition text,custom_language text,
 stage text NOT NULL DEFAULT 'Core',imported_collection_id uuid REFERENCES vocabulary_collections(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(word_list_id,dictionary_entry_id)
);
CREATE TABLE learning_progress (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),word_list_entry_id uuid NOT NULL UNIQUE REFERENCES word_list_entries(id) ON DELETE CASCADE,
 familiarity integer NOT NULL DEFAULT 0 CHECK(familiarity BETWEEN 0 AND 5),next_review_at timestamptz
);

ALTER TABLE IF EXISTS user_words ADD COLUMN IF NOT EXISTS custom_language text;
ALTER TABLE IF EXISTS user_words ADD COLUMN IF NOT EXISTS familiarity integer NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS user_words ADD COLUMN IF NOT EXISTS next_review_at timestamptz;

ALTER TABLE IF EXISTS user_words ALTER COLUMN definition TYPE text;
ALTER TABLE IF EXISTS user_words ADD COLUMN IF NOT EXISTS learning_stage text NOT NULL DEFAULT 'Core';
