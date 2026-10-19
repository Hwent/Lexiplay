CREATE INDEX dictionary_entries_game_length_idx
  ON dictionary_entries (char_length(term), term)
  WHERE term ~ '^[a-z]+$'
    AND part_of_speech NOT IN ('proper noun', 'proper_noun', 'name');
