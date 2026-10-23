CREATE TABLE thesaurus_senses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  source_entry_id text NOT NULL,
  sense_key text NOT NULL,
  term text NOT NULL CHECK (btrim(term) <> ''),
  part_of_speech text NOT NULL,
  definition text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata)='object'),
  dictionary_entry_id uuid REFERENCES dictionary_entries(id) ON DELETE SET NULL,
  UNIQUE(source,source_entry_id,sense_key)
);
CREATE INDEX thesaurus_senses_term_idx ON thesaurus_senses(term);
CREATE INDEX thesaurus_senses_dictionary_entry_id_idx ON thesaurus_senses(dictionary_entry_id);
CREATE TABLE thesaurus_relations (
  sense_id uuid NOT NULL REFERENCES thesaurus_senses(id) ON DELETE CASCADE,
  target_term text NOT NULL CHECK (btrim(target_term) <> ''),
  kind text NOT NULL CHECK (kind IN ('synonym','antonym','similar','related','near_antonym','opposite')),
  source_list text NOT NULL,
  group_order integer NOT NULL CHECK (group_order >= 0),
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata)='object'),
  PRIMARY KEY(sense_id,kind,target_term)
);
CREATE INDEX thesaurus_relations_target_term_idx ON thesaurus_relations(target_term);
