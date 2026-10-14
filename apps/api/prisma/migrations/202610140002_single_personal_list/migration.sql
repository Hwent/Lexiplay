BEGIN;
CREATE TABLE IF NOT EXISTS user_words (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),list_id uuid NOT NULL REFERENCES user_word_lists(id) ON DELETE CASCADE,
 term varchar(100) NOT NULL CHECK(btrim(term)<>''),definition text NOT NULL DEFAULT '',part_of_speech text,
 status varchar(16) NOT NULL DEFAULT 'UNFAMILIAR' CHECK(status IN ('KNOWN','UNFAMILIAR')),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 custom_language text,familiarity integer NOT NULL DEFAULT 0,next_review_at timestamptz,learning_stage text NOT NULL DEFAULT 'Core',UNIQUE(list_id,term)
);
-- Preserve a recovery copy before consolidating existing lists.
CREATE TABLE IF NOT EXISTS word_list_consolidation_backup AS
SELECT l.id AS list_id,to_jsonb(l) AS list_data,
  (SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) FROM word_list_entries e WHERE e.word_list_id=l.id) AS entries,
  (SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) FROM learning_progress p JOIN word_list_entries e ON e.id=p.word_list_entry_id WHERE e.word_list_id=l.id) AS progress,
  (SELECT coalesce(jsonb_agg(to_jsonb(w)),'[]'::jsonb) FROM user_words w WHERE w.list_id=l.id) AS legacy_words
FROM user_word_lists l;
CREATE TABLE user_vocabulary_collections (
 user_id uuid NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
 collection_id uuid NOT NULL REFERENCES vocabulary_collections(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,collection_id)
);
INSERT INTO user_vocabulary_collections(user_id,collection_id)
SELECT DISTINCT l.owner_id,e.imported_collection_id FROM user_word_lists l JOIN word_list_entries e ON e.word_list_id=l.id WHERE e.imported_collection_id IS NOT NULL ON CONFLICT DO NOTHING;
DO $$ BEGIN
 IF to_regclass('public.user_game_pools') IS NOT NULL THEN
  INSERT INTO user_vocabulary_collections(user_id,collection_id)
  SELECT u.owner_id,c.id FROM user_game_pools u JOIN vocabulary_collections c ON u.pool_id='oxford-' || lower(c.level) WHERE c.category='CEFR' ON CONFLICT DO NOTHING;
 END IF;
END $$;
CREATE TEMP TABLE list_targets ON COMMIT DROP AS
SELECT id,first_value(id) OVER(PARTITION BY owner_id ORDER BY is_default DESC,created_at,id) AS target FROM user_word_lists;
-- Existing overall-list entries win duplicates; all originals remain in the snapshot above.
DELETE FROM word_list_entries e USING list_targets t
WHERE e.word_list_id=t.id AND t.id<>t.target AND EXISTS(SELECT 1 FROM word_list_entries d WHERE d.word_list_id=t.target AND d.dictionary_entry_id=e.dictionary_entry_id);
DELETE FROM word_list_entries e USING word_list_entries d,list_targets t,list_targets u
WHERE e.word_list_id=t.id AND d.word_list_id=u.id AND t.target=u.target AND t.id<>t.target AND u.id<>u.target AND e.dictionary_entry_id=d.dictionary_entry_id AND e.id>d.id;
UPDATE word_list_entries e SET word_list_id=t.target FROM list_targets t WHERE e.word_list_id=t.id AND t.id<>t.target;
DELETE FROM user_words w USING list_targets t WHERE w.list_id=t.id AND t.id<>t.target AND EXISTS(SELECT 1 FROM user_words d WHERE d.list_id=t.target AND lower(d.term)=lower(w.term));
DELETE FROM user_words w USING user_words d,list_targets t,list_targets u WHERE w.list_id=t.id AND d.list_id=u.id AND t.target=u.target AND t.id<>t.target AND u.id<>u.target AND lower(w.term)=lower(d.term) AND w.id>d.id;
UPDATE user_words w SET list_id=t.target FROM list_targets t WHERE w.list_id=t.id AND t.id<>t.target;
DELETE FROM user_word_lists l USING list_targets t WHERE l.id=t.id AND t.id<>t.target;
UPDATE user_word_lists SET is_default=true,name='My Word List';
CREATE UNIQUE INDEX user_word_lists_owner_id_key ON user_word_lists(owner_id);

COMMIT;
