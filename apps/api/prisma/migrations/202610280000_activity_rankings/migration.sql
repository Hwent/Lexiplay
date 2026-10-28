ALTER TABLE practice_games ADD COLUMN gave_up boolean NOT NULL DEFAULT false;
UPDATE practice_games SET gave_up=true WHERE status='lost' AND (
  ladder_state IS NOT NULL OR attempt_count < CASE difficulty WHEN 'easy' THEN 7 WHEN 'hard' THEN 5 ELSE 6 END
);

CREATE TABLE animal_guess_games (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES account_users(id) ON DELETE CASCADE,
  guest_session_id uuid REFERENCES guest_sessions(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('won','lost')),
  question_count smallint NOT NULL CHECK (question_count BETWEEN 4 AND 15),
  guess_count smallint NOT NULL CHECK (guess_count BETWEEN 1 AND 3),
  finished_at timestamptz NOT NULL,
  CHECK ((user_id IS NOT NULL) <> (guest_session_id IS NOT NULL)),
  CHECK (status='won' OR guess_count=3)
);
CREATE INDEX animal_guess_games_user_finished_idx ON animal_guess_games(user_id,finished_at);
CREATE INDEX animal_guess_games_guest_idx ON animal_guess_games(guest_session_id);
