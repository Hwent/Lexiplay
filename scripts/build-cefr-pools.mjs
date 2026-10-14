import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const parts = { noun: 'noun', verb: 'verb', adj: 'adjective', adjective: 'adjective', adv: 'adverb', pron: 'pronoun', prep: 'preposition', conj: 'conjunction', det: 'determiner', num: 'number', interj: 'interjection', part: 'particle' };
const folder = resolve(project, 'apps/api/src/modules/word-lists/pools');
await mkdir(folder, { recursive: true });
for (const level of ['A1', 'A2', 'B1', 'B2', 'C1']) {
  const rows = JSON.parse(await readFile(resolve(project, 'test_materials/en-' + level + '.json'), 'utf8'));
  const words = new Map();
  for (const row of rows) {
    const partOfSpeech = parts[row.pos.toLowerCase()];
    if (row.cefr_level !== level || row.language !== 'en' || !['oxford_3000_5000', 'oxford_3000'].includes(row.source) || !partOfSpeech || !row.lemma?.trim()) throw new Error('Invalid source row in ' + level);
    const term = row.lemma.trim().toLowerCase();
    const positions = words.get(term) ?? new Set();
    positions.add(partOfSpeech); words.set(term, positions);
  }
  const pool = { id: 'oxford-' + level.toLowerCase(), name: 'Oxford ' + level, level, author: 'oxford_3000_5000', words: [...words].sort(([a], [b]) => a.localeCompare(b)).map(([term, positions]) => ({ term, partsOfSpeech: [...positions] })) };
  await writeFile(resolve(folder, pool.id + '.json'), JSON.stringify(pool, null, 2) + '\n');
  console.log(level + ': ' + pool.words.length + ' words');
}

