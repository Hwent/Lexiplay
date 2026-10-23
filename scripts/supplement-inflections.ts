import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { Pool } from '../apps/api/node_modules/pg';
import { definitionInflections, websterInflections, type Inflection } from '../apps/api/src/modules/word-lists/dictionary-inflections';
import { planInflections, applyInflections, inflectionFingerprint, type InflectionPlan } from '../apps/api/src/modules/word-lists/inflection-import';
import { localDatabase } from './database-maintenance';

async function readJson<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

async function fetchInflections(key: string, terms: string[], limit: number, folder: string) {
  await mkdir(folder, { recursive: true });
  const lockPath = resolve(folder, 'fetch.lock');
  const lock = await open(lockPath, 'wx').catch(() => { throw new Error('Another API import is running (fetch.lock).'); });
  try {
    const keyId = createHash('sha256').update(key).digest('hex').slice(0, 16);
    const usagePath = resolve(folder, `usage-${keyId}.json`);
    let usage = await readJson<{ day: string; requests: number }>(usagePath) ?? { day: '', requests: 0 };
    const links: Inflection[] = [];
    let requested = 0, cached = 0;
    for (const term of terms) {
      const cachePath = resolve(folder, createHash('sha256').update(term).digest('hex') + '.json');
      let response = await readJson<unknown>(cachePath);
      if (response === undefined) {
        if (requested >= limit) break;
        const day = new Date().toISOString().slice(0, 10);
        if (usage.day !== day) usage = { day, requests: 0 };
        if (usage.requests >= 1000) { console.log('Daily importer budget reached; rerun on another UTC day.'); break; }
        // Record before sending, so failures and interrupted requests consume budget too.
        usage.requests++; requested++;
        await writeFile(usagePath, JSON.stringify(usage));
        let result: Response;
        try {
          result = await fetch(`https://www.dictionaryapi.com/api/v3/references/collegiate/json/${encodeURIComponent(term)}?key=${encodeURIComponent(key)}`,
            { signal: AbortSignal.timeout(15000) });
        } catch { throw new Error('Dictionary API request failed; cached results are preserved.'); }
        if (!result.ok) throw new Error(`Dictionary API returned HTTP ${result.status}; stopped without retrying.`);
        response = await result.json().catch(() => { throw new Error('Dictionary API returned invalid JSON. Check the product assigned to DICTIONARYAPI1.'); });
        websterInflections(response, term); // Validate before caching; suggestions are cached but never imported.
        await writeFile(cachePath, JSON.stringify(response));
      } else cached++;
      links.push(...websterInflections(response, term));
    }
    console.log(JSON.stringify({ requested, cached, apiLinks: links.length }));
    return links;
  } finally { await lock.close(); await unlink(lockPath); }
}

async function main() {
  const { values } = parseArgs({ options: {
    'database-env': { type: 'string', default: '.env' }, report: { type: 'string', default: '.local-backups/inflections/report.json' },
    apply: { type: 'string' }, fetch: { type: 'boolean' }, terms: { type: 'string' }, limit: { type: 'string', default: '100' },
  } });
  const env = parseEnv(await readFile(resolve(values['database-env']!), 'utf8'));
  const database = localDatabase(env.DATABASE_URL ?? '');
  const pool = new Pool({ connectionString: database.href });
  try {
    if (values.apply) {
      if (values.fetch || values.terms) throw new Error('--apply uses the reviewed report; do not combine with --fetch or --terms.');
      const report = await readJson<{ database: string; fingerprint: string; plan: InflectionPlan }>(resolve(values.apply));
      if (!report || report.database !== database.pathname.slice(1)) throw new Error('Report targets a different database.');
      const fresh = await planInflections(pool, report.plan.links);
      // Skipped candidates do not affect the write plan.
      fresh.skipped = report.plan.skipped;
      if (inflectionFingerprint(fresh) !== report.fingerprint) throw new Error('Report is stale or edited. Generate a fresh report.');
      console.log(JSON.stringify(await applyInflections(pool, fresh), null, 2));
      return;
    }
    const rows = (await pool.query<{ term: string; pos: string; definition: string }>(`SELECT e.term,e.part_of_speech pos,d.definition
      FROM dictionary_entries e JOIN dictionary_definitions d ON d.dictionary_entry_id=e.id
      WHERE d.language_code='en' AND d.source_label IS DISTINCT FROM 'lexiplay-inflection'
      ORDER BY e.term,e.part_of_speech,d.sense_order`)).rows;
    const links = rows.flatMap(row => definitionInflections(row.term, row.pos, row.definition));
    if (values.fetch) {
      if (!env.DICTIONARYAPI1) throw new Error('DICTIONARYAPI1 must contain the Collegiate Dictionary key.');
      if (!values.terms) throw new Error('--fetch requires --terms <one-term-per-line.txt>.');
      const limit = Number(values.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('--limit must be between 1 and 1000.');
      const terms = [...new Set((await readFile(resolve(values.terms), 'utf8')).split(/\r?\n/).map(term => term.trim()).filter(Boolean))];
      if (terms.some(term => term.length > 100 || /[\u0000-\u001f]/.test(term))) throw new Error('Invalid input term.');
      links.push(...await fetchInflections(env.DICTIONARYAPI1, terms, limit, resolve('.local-backups/merriam-webster-collegiate')));
    }
    const plan = await planInflections(pool, links);
    const path = resolve(values.report!);
    await mkdir(resolve(path, '..'), { recursive: true });
    await writeFile(path, JSON.stringify({ database: database.pathname.slice(1), fingerprint: inflectionFingerprint(plan), plan }, null, 2));
    console.log(JSON.stringify({ links: plan.links.length, newEntries: plan.newEntries.length, skipped: plan.skipped.length, report: path }, null, 2));
  } finally { await pool.end(); }
}
void main().catch(error => {
  console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[database URL]') : 'Inflection import failed.');
  process.exitCode = 1;
});
