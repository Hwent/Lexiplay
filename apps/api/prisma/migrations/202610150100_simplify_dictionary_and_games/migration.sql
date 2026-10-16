BEGIN;

CREATE TABLE library_state (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id=1),
  version uuid NOT NULL DEFAULT gen_random_uuid()
);
INSERT INTO library_state DEFAULT VALUES;

ALTER TABLE dictionary_entries ADD COLUMN term text COLLATE "C",
  ADD COLUMN family_id text REFERENCES word_families(id) ON DELETE SET NULL ON UPDATE CASCADE;
UPDATE dictionary_entries e SET term=w.term,family_id=w.family_id,
  source_metadata=jsonb_build_object('word',w.source_metadata)||e.source_metadata
  FROM dictionary_words w WHERE w.id=e.word_id;
ALTER TABLE dictionary_entries ALTER COLUMN term SET NOT NULL;
ALTER TABLE dictionary_entries ADD CHECK (btrim(term)<>''),
  ADD CONSTRAINT dictionary_entries_term_part_of_speech_key UNIQUE(term,part_of_speech);
CREATE INDEX dictionary_entries_family_id_idx ON dictionary_entries(family_id);
CREATE INDEX dictionary_entries_search_idx ON dictionary_entries(lower(term COLLATE "default") text_pattern_ops);

ALTER TABLE dictionary_definitions ADD COLUMN language_code text NOT NULL DEFAULT 'en'
  CHECK (language_code ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$');
ALTER TABLE dictionary_definitions DROP CONSTRAINT dictionary_definitions_pkey;
DROP INDEX dictionary_definitions_dictionary_entry_id_sense_order_key;
ALTER TABLE dictionary_definitions DROP COLUMN id,
  ADD PRIMARY KEY(dictionary_entry_id,language_code,sense_order);

-- Keep case-sensitive answers independent of dictionary lifetime; gameplay uses lowercase.
ALTER TABLE practice_games ADD COLUMN answer text,
  ADD COLUMN attempt_count smallint NOT NULL DEFAULT 0,
  ADD COLUMN coin_change integer,
  ADD COLUMN active_state jsonb;
UPDATE practice_games g SET answer=lower(w.term),
  attempt_count=(SELECT count(*) FROM practice_guesses q WHERE q.game_id=g.id),
  coin_change=CASE WHEN g.status='won' THEN g.win_reward_coins-g.coin_cost
    WHEN g.cost_refunded_at IS NOT NULL THEN 0 ELSE -g.coin_cost END,
  active_state=CASE WHEN g.status='active' THEN jsonb_build_object(
    'guesses',COALESCE((SELECT jsonb_agg(lower(gw.term) ORDER BY q.position)
      FROM practice_guesses q JOIN dictionary_words gw ON gw.id=q.word_id WHERE q.game_id=g.id),'[]'::jsonb),
    'hints',jsonb_build_object('unused',g.unused_hints_remaining,'present',g.present_hints_remaining),
    'revealedAbsent',g.revealed_absent,'revealedPresent',g.revealed_present,
    'coinCost',g.coin_cost,'winRewardCoins',g.win_reward_coins,'startedAt',g.started_at) END
  FROM dictionary_words w WHERE g.answer_word_id=w.id;
-- An old cancelled game may not yet have been refunded.
UPDATE account_users u SET coin_balance=u.coin_balance+r.amount FROM (
  SELECT coin_user_id,sum(-coin_change)::int amount FROM practice_games
  WHERE status='cancelled' AND coin_change<0 AND coin_user_id IS NOT NULL GROUP BY coin_user_id
) r WHERE u.id=r.coin_user_id;
UPDATE guest_sessions u SET coin_balance=u.coin_balance+r.amount FROM (
  SELECT coin_guest_session_id,sum(-coin_change)::int amount FROM practice_games
  WHERE status='cancelled' AND coin_change<0 AND coin_guest_session_id IS NOT NULL GROUP BY coin_guest_session_id
) r WHERE u.id=r.coin_guest_session_id;
UPDATE practice_games SET coin_change=0 WHERE status='cancelled';
UPDATE practice_games SET collection_id=NULL WHERE status<>'active';
ALTER TABLE practice_games ALTER COLUMN answer SET NOT NULL, ALTER COLUMN coin_change SET NOT NULL;
DROP TABLE practice_guesses;
ALTER TABLE practice_games DROP COLUMN answer_word_id, DROP COLUMN started_revision_id,
  DROP COLUMN word_length,DROP COLUMN attempt_limit,DROP COLUMN unused_hints_remaining,
  DROP COLUMN present_hints_remaining,DROP COLUMN revealed_absent,DROP COLUMN revealed_present,
  DROP COLUMN coin_cost,DROP COLUMN win_reward_coins,DROP COLUMN reward_credited_at,
  DROP COLUMN cost_refunded_at,DROP COLUMN cancellation_reason,DROP COLUMN started_at;
ALTER TABLE practice_games
  ADD CHECK (answer ~ '^[a-z]{3,9}$'), ADD CHECK (attempt_count>=0),
  ADD CHECK ((status='active')=(active_state IS NOT NULL)),
  ADD CHECK (active_state IS NULL OR jsonb_typeof(active_state)='object'),
  ADD CHECK (status<>'cancelled' OR coin_change=0),
  ADD CHECK (status<>'lost' OR coin_change<=0),
  ADD CHECK (status<>'active' OR coin_change<=0);

-- Retired identities cannot be silently removed from personal vocabulary or collections.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM dictionary_entries e JOIN dictionary_words w ON w.id=e.word_id
    WHERE (e.retired_at IS NOT NULL OR w.retired_at IS NOT NULL) AND
      (EXISTS(SELECT 1 FROM user_words u WHERE u.dictionary_entry_id=e.id)
       OR EXISTS(SELECT 1 FROM collection_entries c WHERE c.dictionary_entry_id=e.id))) THEN
    RAISE EXCEPTION 'Retired dictionary entries have references; review the differences before migration';
  END IF;
END $$;
DELETE FROM dictionary_entries e USING dictionary_words w WHERE e.word_id=w.id
  AND (e.retired_at IS NOT NULL OR w.retired_at IS NOT NULL);
ALTER TABLE dictionary_entries DROP COLUMN word_id,DROP COLUMN retired_at;
ALTER TABLE vocabulary_collections DROP COLUMN revision_id;
DROP TABLE dictionary_words;
DROP TABLE library_revisions;
COMMIT;
