import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { Pool } from '../apps/api/node_modules/pg';
import { websterThesaurus } from '../apps/api/src/modules/word-lists/webster-thesaurus';
import { planThesaurus, applyThesaurus, thesaurusFingerprint, type ThesaurusPlan } from '../apps/api/src/modules/word-lists/thesaurus-import';
import { localDatabase } from './database-maintenance';
import { fetchWebster, readJson } from './merriam-webster';

async function main() {
  const { values } = parseArgs({ options: {
    'database-env': { type: 'string', default: '.env' }, report: { type: 'string', default: '.local-backups/thesaurus/report.json' },
    terms: { type: 'string' }, limit: { type: 'string', default: '1000' }, apply: { type: 'string' },
  } });
  const env = parseEnv(await readFile(resolve(values['database-env']!), 'utf8'));
  const database = localDatabase(env.DATABASE_URL ?? '');
  const pool = new Pool({ connectionString: database.href });
  try {
    if (values.apply) {
      if (values.terms) throw new Error('--apply uses the report; do not combine with --terms.');
      const report = await readJson<{ database: string; fingerprint: string; plan: ThesaurusPlan }>(resolve(values.apply));
      if (!report || report.database !== database.pathname.slice(1)) throw new Error('Report targets a different database.');
      const fresh = await planThesaurus(pool, report.plan.senses);
      if (thesaurusFingerprint(fresh) !== report.fingerprint) throw new Error('Report is stale or edited. Generate a fresh report.');
      console.log(JSON.stringify(await applyThesaurus(pool, fresh), null, 2));
      return;
    }
    if (!env.DICTIONARYAPI2) throw new Error('DICTIONARYAPI2 must contain the Collegiate Thesaurus key.');
    let terms: string[];
    if (values.terms) {
      terms = [...new Set((await readFile(resolve(values.terms), 'utf8')).split(/\r?\n/).map(term => term.trim()).filter(Boolean))];
    } else {
      terms = (await pool.query<{ term: string }>(`SELECT e.term FROM dictionary_entries e
        LEFT JOIN collection_entries ce ON ce.dictionary_entry_id=e.id
        LEFT JOIN vocabulary_collections c ON c.id=ce.collection_id
        LEFT JOIN word_families f ON f.id=e.family_id
        WHERE e.term~'^[a-z]+$' AND e.part_of_speech IN ('noun','verb','adjective','adverb')
        AND EXISTS(SELECT 1 FROM dictionary_definitions d WHERE d.dictionary_entry_id=e.id AND d.language_code='en')
        AND NOT EXISTS(SELECT 1 FROM dictionary_inflections i WHERE i.form_entry_id=e.id)
        GROUP BY e.term ORDER BY
          min(CASE c.slug WHEN 'cefr-a1' THEN 1 WHEN 'cefr-a2' THEN 2 WHEN 'cefr-b1' THEN 3 WHEN 'cefr-b2' THEN 4 WHEN 'cefr-c1' THEN 5 WHEN 'cefr-c2' THEN 6 ELSE 7 END),
          min(CASE e.part_of_speech WHEN 'adjective' THEN 0 WHEN 'verb' THEN 1 WHEN 'adverb' THEN 2 ELSE 3 END),
          min(coalesce(f.band,99)),e.term`)).rows.map(row => row.term);
    }
    if (terms.some(term => term.length > 100 || /[\u0000-\u001f\u007f]/.test(term))) throw new Error('Invalid input term.');
    const senses = await fetchWebster({ reference: 'thesaurus', key: env.DICTIONARYAPI2, terms, limit: Number(values.limit), parse: websterThesaurus });
    const plan = await planThesaurus(pool, senses);
    const path = resolve(values.report!);
    await mkdir(resolve(path, '..'), { recursive: true });
    await writeFile(path, JSON.stringify({ database: database.pathname.slice(1), fingerprint: thesaurusFingerprint(plan), plan }, null, 2));
    const counts = plan.senses.flatMap(sense => sense.relations).reduce<Record<string, number>>((totals, relation) => {
      totals[relation.kind] = (totals[relation.kind] ?? 0) + 1; return totals;
    }, {});
    console.log(JSON.stringify({ headwords: new Set(plan.senses.map(sense => sense.term)).size, senses: plan.senses.length, relations: counts, report: path }, null, 2));
  } finally { await pool.end(); }
}
void main().catch(error => {
  console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[database URL]') : 'Thesaurus import failed.');
  process.exitCode = 1;
});
