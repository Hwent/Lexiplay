import { Pool } from 'pg';

const apiUrl = 'https://simple.wiktionary.org/w/api.php';
const sourceName = 'Simple English Wiktionary';
const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgresql://lexiplay:lexiplay@127.0.0.1:5432/lexiplay' });

type WikiPage = { title: string; extract?: string };
type WikiResponse = {
  continue?: Record<string, string>;
  query?: { pages?: WikiPage[] };
  error?: { code: string; info: string };
};

function cleanDefinition(extract: string | undefined) {
  return (extract ?? '')
    .replace(/\[\d+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);
}

async function fetchPageBatch(params: URLSearchParams): Promise<WikiResponse> {
  const url = new URL(apiUrl);
  for (const [key, value] of params) url.searchParams.set(key, value);
  let lastError: unknown;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'LexiPlay dictionary importer/1.0 (https://github.com/Hwent/Lexiplay)' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Wiktionary API returned HTTP ${response.status}`);
      const result = await response.json() as WikiResponse;
      if (result.error) throw new Error(`Wiktionary API error ${result.error.code}: ${result.error.info}`);
      return result;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 10_000)));
    }
  }

  throw lastError;
}

async function* wiktionaryEntries() {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'allpages',
    gapnamespace: '0',
    gapfilterredir: 'nonredirects',
    gaplimit: '500',
    prop: 'extracts',
    exintro: '1',
    explaintext: '1',
    exchars: '2000',
    maxlag: '5',
    format: 'json',
    formatversion: '2',
  });

  while (true) {
    const result = await fetchPageBatch(params);
    for (const page of result.query?.pages ?? []) {
      const term = page.title.toLowerCase();
      const definition = cleanDefinition(page.extract);
      if (!/^[a-z][a-z '-]{0,99}$/.test(term) || !definition) continue;
      yield { term, definition };
    }

    if (!result.continue) break;
    for (const [key, value] of Object.entries(result.continue)) params.set(key, value);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

async function seed() {
  const client = await pool.connect();
  let count = 0;
  let batch: Array<{ term: string; definition: string }> = [];

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS dictionary_words (
        term varchar(100) PRIMARY KEY,
        definition text NOT NULL,
        part_of_speech text[] NOT NULL DEFAULT '{}',
        source varchar(80) NOT NULL DEFAULT '${sourceName}'
      );
      CREATE INDEX IF NOT EXISTS dictionary_words_term_prefix_idx ON dictionary_words(term text_pattern_ops);
      ALTER TABLE dictionary_words ALTER COLUMN source SET DEFAULT '${sourceName}';
    `);
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE dictionary_words_stage (
        term varchar(100) PRIMARY KEY,
        definition text NOT NULL,
        part_of_speech text[] NOT NULL DEFAULT '{}',
        source varchar(80) NOT NULL
      ) ON COMMIT DROP;
    `);

    const insertBatch = async () => {
      if (!batch.length) return;
      const grouped = new Map<string, string>();
      for (const item of batch) {
        const existing = grouped.get(item.term);
        if (!existing || item.definition.length < existing.length) grouped.set(item.term, item.definition);
      }
      const terms = [...grouped.keys()];
      const definitions = [...grouped.values()];
      await client.query(
        `INSERT INTO dictionary_words_stage (term, definition, source)
         SELECT incoming.term, incoming.definition, $3
         FROM UNNEST($1::text[], $2::text[]) AS incoming(term, definition)
         ON CONFLICT (term) DO UPDATE SET
           definition = CASE WHEN length(EXCLUDED.definition) < length(dictionary_words_stage.definition)
             THEN EXCLUDED.definition ELSE dictionary_words_stage.definition END`,
        [terms, definitions, sourceName],
      );
      count += grouped.size;
      batch = [];
      if (count > 0 && count % 5000 === 0) console.log(`${count.toLocaleString()} Simple English Wiktionary entries prepared…`);
    };

    for await (const entry of wiktionaryEntries()) {
      batch.push(entry);
      if (batch.length >= 500) await insertBatch();
    }
    await insertBatch();
    if (count === 0) throw new Error('The Wiktionary API returned no usable dictionary entries; the existing dictionary was kept.');

    const { rows: countRows } = await client.query<{ count: string }>('SELECT count(*)::text AS count FROM dictionary_words_stage');
    const entryCount = Number(countRows[0]?.count ?? 0);
    await client.query('DELETE FROM dictionary_words');
    await client.query('INSERT INTO dictionary_words (term, definition, part_of_speech, source) SELECT term, definition, part_of_speech, source FROM dictionary_words_stage');
    await client.query('COMMIT');
    console.log(`Simple English Wiktionary loaded; ${entryCount.toLocaleString()} dictionary entries are available.`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

void seed().catch(error => {
  console.error('Could not seed the Simple English Wiktionary dictionary.', error);
  process.exitCode = 1;
}).finally(() => pool.end());
