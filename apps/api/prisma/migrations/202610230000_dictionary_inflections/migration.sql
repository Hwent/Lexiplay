CREATE TABLE dictionary_inflections (
  base_entry_id uuid NOT NULL REFERENCES dictionary_entries(id) ON DELETE CASCADE,
  form_entry_id uuid NOT NULL REFERENCES dictionary_entries(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('plural','past','past_participle','present_participle','third_person_singular','comparative','superlative','verb_form')),
  source text NOT NULL,
  source_ref text NOT NULL,
  PRIMARY KEY (base_entry_id,form_entry_id,kind),
  CHECK (base_entry_id <> form_entry_id)
);
CREATE INDEX dictionary_inflections_form_entry_idx ON dictionary_inflections(form_entry_id);
