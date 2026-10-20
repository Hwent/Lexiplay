ALTER TABLE practice_games ADD COLUMN ladder_state jsonb;
ALTER TABLE practice_games ADD CHECK (ladder_state IS NULL OR jsonb_typeof(ladder_state) = 'object');
