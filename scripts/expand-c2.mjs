import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseFamilyFile } from './audit-cefr-families.mjs';
import { csvRecords } from './csv-records.mjs';

process.loadEnvFile('.env');
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://lexiplay:lexiplay@127.0.0.1:5432/lexiplay');
if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw new Error('Local dictionary verification required.');
const sourceFile = '.local-backups/c2-expansion/octanove-vocabulary-profile-c1c2-1.0.csv';
const bytes = await readFile(sourceFile);
if (createHash('sha256').update(bytes).digest('hex') !== '18c33a407f2f89f7b8de9671c6d45fe3ea0bce45e7d2d7dcaab48d73e0f7b380') throw new Error('Unexpected Octanove source version.');
const familyForms = new Set();
for (let band = 1; band <= 25; band++) for (const family of parseFamilyFile(await readFile(`.local-backups/word-families/bnc-coca/basewrd${band}.txt`, 'utf8'), band)) {
  family.members.forEach(member => familyForms.add(member));
}
const lines = csvRecords(bytes.toString('utf8').replace(/^\uFEFF/, ''));
if (lines.shift().join(',') !== 'headword,pos,CEFR,notes') throw new Error('Unexpected CSV format.');
const candidates = new Map();
for (const line of lines) {
  const [headword, rawPos, level, note] = line;
  if (level?.trim() !== 'C2') continue;
  for (const value of headword.split('/')) {
    const term = value.normalize('NFC').trim().toLowerCase();
    // A source typo is corrected only for this explicitly reviewed verb.
    const partOfSpeech = rawPos === 'vern' && term === 'remonstrate' ? 'verb' : rawPos.trim();
    const key=term+'\0'+partOfSpeech, existing=candidates.get(key);
    candidates.set(key, { term, partOfSpeech, note: [...new Set([existing?.note,note?.trim()].filter(Boolean))].join('; ') });
  }
}
const require = createRequire(resolve('apps/api/package.json'));
const { Pool } = require('pg'), db = new Pool({ connectionString: url.href });
try {
  const words = (await db.query(`SELECT e.term,jsonb_agg(jsonb_build_object('partOfSpeech',e.part_of_speech,'definitions',
    (SELECT jsonb_agg(d.definition ORDER BY d.sense_order) FROM dictionary_definitions d WHERE d.dictionary_entry_id=e.id AND d.language_code='en'))) senses
    FROM dictionary_entries e WHERE lower(e.term COLLATE "default")=ANY($1::text[]) GROUP BY e.term`, [[...new Set([...candidates.values()].map(row => row.term))]])).rows;
  const matches = new Map();
  for (const word of words) {
    const senses = matches.get(word.term.toLowerCase()) ?? [];
    senses.push(...word.senses); matches.set(word.term.toLowerCase(), senses);
  }
  const target = 'apps/api/src/modules/word-lists/pools/lexiplay-c2.json';
  const pool = JSON.parse(await readFile(target, 'utf8'));
  const before = pool.words.length, selected = new Map(pool.words.map(word => [word.term, new Set(word.partsOfSpeech)])), omitted = [];
  for (const candidate of candidates.values()) {
    const reason = candidate.note ? 'sense-specific CEFR evidence needs review' : !familyForms.has(candidate.term) ? 'no published family match'
      : !(matches.get(candidate.term) ?? []).some(sense => sense.partOfSpeech === candidate.partOfSpeech && sense.definitions.some(definition => definition.trim())) ? 'no matching dictionary definition' : null;
    if (reason) { omitted.push({ ...candidate, reason }); continue; }
    const positions = selected.get(candidate.term) ?? new Set(); positions.add(candidate.partOfSpeech); selected.set(candidate.term, positions);
  }
  pool.name = 'C2 Advanced'; pool.author = 'LexiPlay; Octanove Labs';
  pool.description = 'An advanced study selection for precise, nuanced English, organized by word family.';
  pool.source = 'https://github.com/openlanguageprofiles/olp-en-cefrj';
  pool.license = 'CC-BY-SA-4.0'; pool.version = 'octanove-1.0-curated-2026-10-14';
  pool.words = [...selected].sort(([a],[b]) => a.localeCompare(b)).map(([term, positions]) => ({ term, partsOfSpeech: [...positions].sort() }));
  const report = { sourceFile, sourceSha256: createHash('sha256').update(bytes).digest('hex'), sourceCommit: 'd4e45b75b38f27b30dfc5c44d8c571aec7e7092f',
    before, after: pool.words.length, dictionaryEntries: pool.words.reduce((count, word) => count + word.partsOfSpeech.length, 0), candidateEntries: candidates.size, omitted };
  await writeFile(target, JSON.stringify(pool, null, 2) + '\n');
  await writeFile('.local-backups/c2-expansion/import-report.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, omitted: omitted.length }));
} finally { await db.end(); }
