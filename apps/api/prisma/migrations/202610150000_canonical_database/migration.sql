-- Rebuild only an empty replacement database. The maintenance command backs up
-- the selected dictionary and imports it after Prisma creates this schema.
BEGIN;
DO $$
DECLARE populated boolean;
BEGIN
  IF to_regclass('public.dictionary_words') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS(SELECT 1 FROM dictionary_words)' INTO populated;
    IF populated THEN RAISE EXCEPTION 'Dictionary data exists. Use db:restructure to prepare a backed-up replacement database.'; END IF;
  END IF;
  IF to_regclass('public.account_users') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS(SELECT 1 FROM account_users)' INTO populated;
    IF populated THEN RAISE EXCEPTION 'Account data exists. Use db:restructure to prepare a backed-up replacement database.'; END IF;
  END IF;
END $$;
DROP TABLE IF EXISTS practice_guesses, practice_games, progress_transfers,
  guest_progress_claims, guest_sessions, account_actions, account_sessions,
  user_game_pools, game_word_pools, user_vocabulary_collections,
  word_list_consolidation_backup, learning_progress, word_list_entries,
  user_words, user_word_lists, collection_entries, vocabulary_collections,
  dictionary_definitions, dictionary_entries, dictionary_source_words,
  dictionary_sources, dictionary_words, word_families, library_revisions,
  account_users CASCADE;
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "account_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "email" VARCHAR(254),
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "coin_balance" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_sessions" (
    "token_hash" CHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "account_sessions_pkey" PRIMARY KEY ("token_hash")
);

-- CreateTable
CREATE TABLE "account_actions" (
    "token_hash" CHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "account_actions_pkey" PRIMARY KEY ("token_hash")
);

-- CreateTable
CREATE TABLE "guest_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token_hash" CHAR(64) NOT NULL,
    "coin_balance" INTEGER NOT NULL DEFAULT 10,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "claimed_at" TIMESTAMPTZ,
    "claimed_by_user_id" UUID,

    CONSTRAINT "guest_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_transfers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "guest_session_id" UUID,
    "payload_hash" CHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "completed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progress_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope" TEXT NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "library_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "word_families" (
    "id" TEXT NOT NULL,
    "headword" TEXT NOT NULL,
    "band" SMALLINT,
    "source_metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "word_families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dictionary_words" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "term" TEXT NOT NULL,
    "family_id" TEXT,
    "revision_id" UUID NOT NULL,
    "retired_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "dictionary_words_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dictionary_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "word_id" UUID NOT NULL,
    "part_of_speech" TEXT NOT NULL,
    "source_metadata" JSONB NOT NULL DEFAULT '{}',
    "retired_at" TIMESTAMPTZ,

    CONSTRAINT "dictionary_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dictionary_definitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dictionary_entry_id" UUID NOT NULL,
    "sense_order" INTEGER NOT NULL,
    "definition" TEXT NOT NULL,
    "source_label" TEXT,

    CONSTRAINT "dictionary_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vocabulary_collections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL,
    "author" TEXT,
    "source_name" TEXT,
    "source_version" TEXT,
    "source_url" TEXT,
    "license" TEXT,
    "revision_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'available',

    CONSTRAINT "vocabulary_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_entries" (
    "collection_id" UUID NOT NULL,
    "dictionary_entry_id" UUID NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'Core',
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "collection_entries_pkey" PRIMARY KEY ("collection_id","dictionary_entry_id")
);

-- CreateTable
CREATE TABLE "user_vocabulary_collections" (
    "user_id" UUID NOT NULL,
    "collection_id" UUID NOT NULL,
    "saved_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_vocabulary_collections_pkey" PRIMARY KEY ("user_id","collection_id")
);

-- CreateTable
CREATE TABLE "user_words" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "dictionary_entry_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "familiarity" SMALLINT NOT NULL DEFAULT 0,
    "stage" TEXT NOT NULL DEFAULT 'Core',
    "next_review_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_words_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_games" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "start_request_id" UUID NOT NULL,
    "user_id" UUID,
    "guest_session_id" UUID,
    "coin_user_id" UUID,
    "coin_guest_session_id" UUID,
    "answer_word_id" UUID NOT NULL,
    "collection_id" UUID,
    "started_revision_id" UUID NOT NULL,
    "word_length" SMALLINT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "attempt_limit" SMALLINT NOT NULL,
    "unused_hints_remaining" SMALLINT NOT NULL,
    "present_hints_remaining" SMALLINT NOT NULL,
    "revealed_absent" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "revealed_present" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "coin_cost" INTEGER NOT NULL,
    "win_reward_coins" INTEGER NOT NULL,
    "reward_credited_at" TIMESTAMPTZ,
    "cost_refunded_at" TIMESTAMPTZ,
    "status" TEXT NOT NULL DEFAULT 'active',
    "cancellation_reason" TEXT,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,

    CONSTRAINT "practice_games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_guesses" (
    "game_id" UUID NOT NULL,
    "position" SMALLINT NOT NULL,
    "word_id" UUID NOT NULL,
    "feedback" TEXT[],
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_guesses_pkey" PRIMARY KEY ("game_id","position")
);

-- CreateIndex
CREATE INDEX "account_sessions_user_id_idx" ON "account_sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_actions_user_id_purpose_key" ON "account_actions"("user_id", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "guest_sessions_token_hash_key" ON "guest_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "guest_sessions_claimed_by_user_id_idx" ON "guest_sessions"("claimed_by_user_id");

-- CreateIndex
CREATE INDEX "progress_transfers_user_id_idx" ON "progress_transfers"("user_id");

-- CreateIndex
CREATE INDEX "progress_transfers_guest_session_id_idx" ON "progress_transfers"("guest_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "library_revisions_scope_fingerprint_key" ON "library_revisions"("scope", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "dictionary_words_term_key" ON "dictionary_words"("term");

-- CreateIndex
CREATE INDEX "dictionary_words_family_id_idx" ON "dictionary_words"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "dictionary_entries_word_id_part_of_speech_key" ON "dictionary_entries"("word_id", "part_of_speech");

-- CreateIndex
CREATE UNIQUE INDEX "dictionary_definitions_dictionary_entry_id_sense_order_key" ON "dictionary_definitions"("dictionary_entry_id", "sense_order");

-- CreateIndex
CREATE UNIQUE INDEX "vocabulary_collections_slug_key" ON "vocabulary_collections"("slug");

-- CreateIndex
CREATE INDEX "collection_entries_collection_id_sort_order_dictionary_entr_idx" ON "collection_entries"("collection_id", "sort_order", "dictionary_entry_id");

-- CreateIndex
CREATE INDEX "collection_entries_dictionary_entry_id_idx" ON "collection_entries"("dictionary_entry_id");

-- CreateIndex
CREATE INDEX "user_vocabulary_collections_collection_id_idx" ON "user_vocabulary_collections"("collection_id");

-- CreateIndex
CREATE INDEX "user_words_user_id_status_created_at_id_idx" ON "user_words"("user_id", "status", "created_at", "id");

-- CreateIndex
CREATE INDEX "user_words_dictionary_entry_id_idx" ON "user_words"("dictionary_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_words_user_id_dictionary_entry_id_key" ON "user_words"("user_id", "dictionary_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "practice_games_start_request_id_key" ON "practice_games"("start_request_id");

-- CreateIndex
CREATE INDEX "practice_games_user_id_finished_at_idx" ON "practice_games"("user_id", "finished_at");

-- CreateIndex
CREATE INDEX "practice_games_guest_session_id_idx" ON "practice_games"("guest_session_id");

-- CreateIndex
CREATE INDEX "practice_games_coin_user_id_idx" ON "practice_games"("coin_user_id");

-- CreateIndex
CREATE INDEX "practice_games_coin_guest_session_id_idx" ON "practice_games"("coin_guest_session_id");

-- CreateIndex
CREATE INDEX "practice_games_answer_word_id_idx" ON "practice_games"("answer_word_id");

-- CreateIndex
CREATE INDEX "practice_games_collection_id_idx" ON "practice_games"("collection_id");

-- CreateIndex
CREATE INDEX "practice_guesses_word_id_idx" ON "practice_guesses"("word_id");

-- AddForeignKey
ALTER TABLE "account_sessions" ADD CONSTRAINT "account_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "account_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_actions" ADD CONSTRAINT "account_actions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "account_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_claimed_by_user_id_fkey" FOREIGN KEY ("claimed_by_user_id") REFERENCES "account_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_transfers" ADD CONSTRAINT "progress_transfers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "account_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_transfers" ADD CONSTRAINT "progress_transfers_guest_session_id_fkey" FOREIGN KEY ("guest_session_id") REFERENCES "guest_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dictionary_words" ADD CONSTRAINT "dictionary_words_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "word_families"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dictionary_words" ADD CONSTRAINT "dictionary_words_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "library_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dictionary_entries" ADD CONSTRAINT "dictionary_entries_word_id_fkey" FOREIGN KEY ("word_id") REFERENCES "dictionary_words"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dictionary_definitions" ADD CONSTRAINT "dictionary_definitions_dictionary_entry_id_fkey" FOREIGN KEY ("dictionary_entry_id") REFERENCES "dictionary_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vocabulary_collections" ADD CONSTRAINT "vocabulary_collections_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "library_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_entries" ADD CONSTRAINT "collection_entries_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "vocabulary_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_entries" ADD CONSTRAINT "collection_entries_dictionary_entry_id_fkey" FOREIGN KEY ("dictionary_entry_id") REFERENCES "dictionary_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_vocabulary_collections" ADD CONSTRAINT "user_vocabulary_collections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "account_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_vocabulary_collections" ADD CONSTRAINT "user_vocabulary_collections_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "vocabulary_collections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_words" ADD CONSTRAINT "user_words_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "account_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_words" ADD CONSTRAINT "user_words_dictionary_entry_id_fkey" FOREIGN KEY ("dictionary_entry_id") REFERENCES "dictionary_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_games" ADD CONSTRAINT "practice_games_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "account_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_games" ADD CONSTRAINT "practice_games_guest_session_id_fkey" FOREIGN KEY ("guest_session_id") REFERENCES "guest_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_games" ADD CONSTRAINT "practice_games_coin_user_id_fkey" FOREIGN KEY ("coin_user_id") REFERENCES "account_users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_games" ADD CONSTRAINT "practice_games_coin_guest_session_id_fkey" FOREIGN KEY ("coin_guest_session_id") REFERENCES "guest_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_games" ADD CONSTRAINT "practice_games_answer_word_id_fkey" FOREIGN KEY ("answer_word_id") REFERENCES "dictionary_words"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_games" ADD CONSTRAINT "practice_games_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "vocabulary_collections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_games" ADD CONSTRAINT "practice_games_started_revision_id_fkey" FOREIGN KEY ("started_revision_id") REFERENCES "library_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_guesses" ADD CONSTRAINT "practice_guesses_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "practice_games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_guesses" ADD CONSTRAINT "practice_guesses_word_id_fkey" FOREIGN KEY ("word_id") REFERENCES "dictionary_words"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- These invariants and expression/partial indexes are owned by migrations.
ALTER TABLE account_users ADD CHECK (btrim(username) <> ''), ADD CHECK (coin_balance >= 0);
CREATE UNIQUE INDEX account_users_username_unique ON account_users(lower(username));
CREATE UNIQUE INDEX account_users_email_unique ON account_users(lower(email)) WHERE email IS NOT NULL;
ALTER TABLE account_sessions ADD CHECK (expires_at > created_at);
ALTER TABLE account_actions ADD CHECK (purpose IN ('reset','verify')), ADD CHECK (expires_at > created_at);
ALTER TABLE guest_sessions ADD CHECK (coin_balance >= 0), ADD CHECK (expires_at > created_at), ADD CHECK (claimed_by_user_id IS NULL OR claimed_at IS NOT NULL);
ALTER TABLE progress_transfers ADD CHECK (jsonb_typeof(result) = 'object');
ALTER TABLE library_revisions ADD CHECK (scope IN ('dictionary','collections','families'));
CREATE UNIQUE INDEX library_revisions_current_unique ON library_revisions(scope) WHERE is_current;
ALTER TABLE word_families ADD CHECK (btrim(headword) <> ''), ADD CHECK (band > 0);
ALTER TABLE dictionary_words ALTER COLUMN term TYPE text COLLATE "C";
ALTER TABLE dictionary_words ADD CHECK (btrim(term) <> '');
CREATE INDEX dictionary_words_search_idx ON dictionary_words(lower(term COLLATE "default") text_pattern_ops);
ALTER TABLE dictionary_entries ADD CHECK (btrim(part_of_speech) <> ''), ADD CHECK (jsonb_typeof(source_metadata) = 'object');
ALTER TABLE dictionary_definitions ADD CHECK (sense_order >= 0), ADD CHECK (btrim(definition) <> '');
ALTER TABLE vocabulary_collections ADD CHECK (btrim(slug) <> ''), ADD CHECK (btrim(name) <> ''), ADD CHECK (btrim(category) <> ''), ADD CHECK (status IN ('available','awaiting_data','retired'));
ALTER TABLE collection_entries ADD CHECK (sort_order >= 0), ADD CHECK (stage IN ('Foundation','Core','Advanced'));
ALTER TABLE user_words ADD CHECK (status IN ('active','excluded')), ADD CHECK (familiarity BETWEEN 0 AND 5), ADD CHECK (stage IN ('Foundation','Core','Advanced'));
CREATE INDEX user_words_review_idx ON user_words(user_id,next_review_at) WHERE status='active';
ALTER TABLE practice_games
  ADD CHECK ((user_id IS NULL) <> (guest_session_id IS NULL)),
  ADD CHECK ((coin_user_id IS NULL) <> (coin_guest_session_id IS NULL)),
  ADD CHECK (word_length BETWEEN 3 AND 9),
  ADD CHECK (difficulty IN ('easy','medium','hard')),
  ADD CHECK (attempt_limit > 0),
  ADD CHECK (unused_hints_remaining >= 0 AND present_hints_remaining >= 0),
  ADD CHECK (coin_cost >= 0 AND win_reward_coins >= 0),
  ADD CHECK (status IN ('active','won','lost','cancelled')),
  ADD CHECK ((status='active' AND finished_at IS NULL) OR (status<>'active' AND finished_at IS NOT NULL)),
  ADD CHECK (finished_at IS NULL OR finished_at >= started_at),
  ADD CHECK (cancellation_reason IS NULL OR status='cancelled'),
  ADD CHECK ((reward_credited_at IS NOT NULL) = (status='won')),
  ADD CHECK (cost_refunded_at IS NULL OR status='cancelled');
ALTER TABLE practice_guesses
  ADD CHECK (position > 0),
  ADD CHECK (cardinality(feedback) BETWEEN 3 AND 9),
  ADD CHECK (feedback <@ ARRAY['CORRECT','PRESENT','ABSENT']::text[]),
  ADD CHECK (array_position(feedback,NULL) IS NULL);
COMMIT;
