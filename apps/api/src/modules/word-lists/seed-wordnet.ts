import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

const wordnet = require('wordnet-db') as { path: string; version: string };
const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgresql://lexiplay:lexiplay@127.0.0.1:5432/lexiplay' });
async function seed() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dictionary_words (
      term varchar(100) PRIMARY KEY,
      definition text NOT NULL,
      part_of_speech text[] NOT NULL DEFAULT '{}',
      source varchar(80) NOT NULL DEFAULT 'Princeton WordNet 3.1'
    );
    CREATE INDEX IF NOT EXISTS dictionary_words_term_prefix_idx ON dictionary_words(term text_pattern_ops);
  `);

  for (const posCode of ['noun', 'verb', 'adj', 'adv']) {
    const pos = posCode === 'adj' ? 'adjective' : posCode === 'adv' ? 'adverb' : posCode;
    const source = readFileSync(join(wordnet.path, `data.${posCode}`), 'utf8');
    const batch: Array<{ term: string; definition: string }> = [];
    for (const line of source.split(/\r?\n/)) {
      const separator = line.indexOf('|');
      if (separator < 0) continue;
      const fields = line.slice(0, separator).trim().split(/\s+/);
      const wordCount = Number.parseInt(fields[3] ?? '', 16);
      if (!Number.isFinite(wordCount) || wordCount < 1) continue;
      const definition = line.slice(separator + 1).trim().replace(/\s+/g, ' ').slice(0, 2000);
      for (let index = 4; index < 4 + wordCount * 2; index += 2) {
        const term = (fields[index] ?? '').replace(/_/g, ' ').toLowerCase();
        if (!/^[a-z][a-z '-]{0,99}$/.test(term)) continue;
        batch.push({ term, definition });
        if (batch.length >= 500) await insertBatch(batch.splice(0), pos);
      }
    }
    if (batch.length) await insertBatch(batch, pos);
  }
  const { rows } = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM dictionary_words');
  console.log(`WordNet ${wordnet.version} dictionary loaded; ${Number(rows[0]?.count ?? 0).toLocaleString()} distinct entries are available.`);
}

async function insertBatch(rows: Array<{ term: string; definition: string }>, pos: string) {
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const definitionsForTerm = grouped.get(row.term) ?? [];
    if (!definitionsForTerm.includes(row.definition)) definitionsForTerm.push(row.definition);
    grouped.set(row.term, definitionsForTerm);
  }
  const terms = [...grouped.keys()];
  const definitions = [...grouped.values()].map(senses => senses.join('; ').slice(0, 2000));
  await pool.query(
    `INSERT INTO dictionary_words (term, definition, part_of_speech)
     SELECT incoming.term, incoming.definition, ARRAY[$3::text]
     FROM UNNEST($1::text[], $2::text[]) AS incoming(term, definition)
     ON CONFLICT (term) DO UPDATE SET
       definition = CASE WHEN position(EXCLUDED.definition in dictionary_words.definition) > 0 THEN dictionary_words.definition ELSE left(dictionary_words.definition || '; ' || EXCLUDED.definition, 2000) END,
       part_of_speech = ARRAY(SELECT DISTINCT value FROM UNNEST(dictionary_words.part_of_speech || EXCLUDED.part_of_speech) AS values(value))`,
    [terms, definitions, pos],
  );
}

void seed().catch(error => {
  console.error('Could not seed the WordNet dictionary.', error);
  process.exitCode = 1;
}).finally(() => pool.end());
