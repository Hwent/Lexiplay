ALTER TABLE practice_games DROP CONSTRAINT practice_games_check3;
ALTER TABLE practice_games ADD CONSTRAINT practice_games_cancelled_coin_change_check
  CHECK (status <> 'cancelled' OR coin_change <= 0);
