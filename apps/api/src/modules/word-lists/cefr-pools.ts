import a1 from './pools/oxford-a1.json';
import a2 from './pools/oxford-a2.json';
import b1 from './pools/oxford-b1.json';
import b2 from './pools/oxford-b2.json';
import c1 from './pools/oxford-c1.json';

export type PoolWord = { term: string; partsOfSpeech: string[] };
export type CefrPool = { id: string; name: string; level: string; author: string; words: PoolWord[] };
export const CEFR_POOLS: CefrPool[] = [a1, a2, b1, b2, c1];
export const CEFR_POOL_IDS = CEFR_POOLS.map(pool => pool.id);
export const poolSummary = (pool: CefrPool) => ({ id: pool.id, name: pool.name, level: pool.level, author: pool.author, wordCount: pool.words.length });

export type DictionaryPoolRow = { term: string; senses: { partOfSpeech: string; definitions: string[] }[] };
export function resolvePoolWord(word: PoolWord, dictionary?: DictionaryPoolRow) {
  const senses = (dictionary?.senses ?? []).filter(sense => word.partsOfSpeech.includes(sense.partOfSpeech)
    || (word.partsOfSpeech.includes('number') && sense.partOfSpeech === 'numeral'));
  const definition = senses.map(sense => (senses.length > 1 ? sense.partOfSpeech + ': ' : '') + sense.definitions.join('; ')).join('\n');
  return { ...word, definition, senses, available: !!definition.trim() };
}
