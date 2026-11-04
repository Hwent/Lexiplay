import properNouns from './proper-nouns.json';
import { CEFR_POOLS } from './cefr-pools';
import { WORDLE_POOL } from './wordle-pool';

const properAnswers = new Set(properNouns.entries.map(entry => entry.term.toLowerCase()).filter(term => /^[a-z]{3,9}$/.test(term)));
const classicAnswers = new Set(WORDLE_POOL.words);
const commonAnswers = new Set(CEFR_POOLS.filter(pool => ['A1', 'A2', 'B1', 'B2'].includes(pool.level))
  .flatMap(pool => pool.words.map(word => word.term)));

export function defaultAnswerWords(length: number, dictionaryWords: string[]) {
  const answers = length === 5 ? classicAnswers : commonAnswers;
  return dictionaryWords.filter(word => word.length === length && (answers.has(word) || properAnswers.has(word)));
}
