import { Pool } from 'pg';
import { applyContinuation } from './wiktionary-pagination';
import { parseWiktionaryDefinition } from './wiktionary-definition';

const apiUrl = 'https://simple.wiktionary.org/w/api.php';
const sourceName = 'Simple English Wiktionary';
const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgresql://lexiplay:lexiplay@127.0.0.1:5432/lexiplay' });

type WikiPage = { title: string; revisions?: Array<{ slots?: { main?: { content?: string } } }> };
type ImportedEntry = { term: string; definition: string; partOfSpeech: string[] };
type WikiResponse = {
  continue?: Record<string, string>;
  query?: { pages?: WikiPage[] };
  error?: { code: string; info: string };
};

class WiktionaryApiError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
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
      if (!response.ok) {
        if (response.status < 500 && response.status !== 429) {
          throw new WiktionaryApiError(`Wiktionary API returned HTTP ${response.status}`, false);
        }
        throw new Error(`Wiktionary API returned HTTP ${response.status}`);
      }
      const result = await response.json() as WikiResponse;
      if (result.error) {
        const requestedContinuation = Object.fromEntries([...params].filter(([key]) => key === 'continue' || key.endsWith('continue')));
        throw new WiktionaryApiError(
          `Wiktionary API error ${result.error.code}: ${result.error.info}; requested continuation ${JSON.stringify(requestedContinuation)}`,
          result.error.code !== 'badcontinue',
        );
      }
      return result;
    } catch (error) {
      if (error instanceof WiktionaryApiError && !error.retryable) throw error;
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
    prop: 'revisions',
    rvprop: 'content',
    rvslots: 'main',
    maxlag: '5',
    format: 'json',
    formatversion: '2',
  });
  let continuationKeys: string[] = [];
  const seenRequests = new Set<string>();

  while (true) {
    const cursor = JSON.stringify([...params].filter(([key]) => key === 'continue' || key.endsWith('continue')).sort(([left], [right]) => left.localeCompare(right)));
    if (seenRequests.has(cursor)) {
      throw new Error(`Wiktionary API repeated a continuation request: ${cursor}`);
    }
    seenRequests.add(cursor);
    const result = await fetchPageBatch(params);
    for (const page of result.query?.pages ?? []) {
      const term = page.title.toLowerCase();
      const { definition, partOfSpeech } = parseWiktionaryDefinition(page.revisions?.[0]?.slots?.main?.content ?? '');
      if (!/^[a-z][a-z '-]{0,99}$/.test(term) || !definition) continue;
      yield { term, definition, partOfSpeech };
    }

    if (!result.continue) break;
    continuationKeys = applyContinuation(params, continuationKeys, result.continue);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

async function seed() {
  const client = await pool.connect();
  let count = 0;
  let batch: ImportedEntry[] = [];

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
      const grouped = new Map<string, ImportedEntry>();
      for (const item of batch) {
        const existing = grouped.get(item.term);
        if (!existing || item.definition.length < existing.definition.length) grouped.set(item.term, item);
      }
      const terms = [...grouped.keys()];
      const definitions = [...grouped.values()].map(item => item.definition);
      const positions = [...grouped.values()].map(item => item.partOfSpeech.join(','));
      await client.query(
        `INSERT INTO dictionary_words_stage (term, definition, part_of_speech, source)
         SELECT incoming.term, incoming.definition, string_to_array(incoming.positions, ','), $4
         FROM UNNEST($1::text[], $2::text[], $3::text[]) AS incoming(term, definition, positions)
         ON CONFLICT (term) DO UPDATE SET
           definition = CASE WHEN length(EXCLUDED.definition) < length(dictionary_words_stage.definition)
             THEN EXCLUDED.definition ELSE dictionary_words_stage.definition END`,
        [terms, definitions, positions, sourceName],
      );
      count += grouped.size;
      batch = [];
      console.log(`${count.toLocaleString()} Simple English Wiktionary entries prepared…`);
    };

    for await (const entry of wiktionaryEntries()) {
      batch.push(entry);
      if (batch.length >= 500) await insertBatch();
    }
    await insertBatch();
    if (count === 0) throw new Error('The Wiktionary API returned no usable dictionary entries; the existing dictionary was kept.');

    const { rows: countRows } = await client.query<{ count: string }>('SELECT count(*)::text AS count FROM dictionary_words_stage');
    const entryCount = Number(countRows[0]?.count ?? 0);
    const { rows: sentinel } = await client.query("SELECT term FROM dictionary_words_stage WHERE term = 'because'");
    if (!sentinel.length) throw new Error('The import is missing the common word because; the existing dictionary was kept.');
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
