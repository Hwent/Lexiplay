import { describe, expect, it } from 'vitest';
import { CEFR_POOLS, resolvePoolWord } from './cefr-pools';

describe('official collection source files', () => {
  it('ships supplied Oxford levels and the curated C2 starter without embedded definitions', () => {
    expect(CEFR_POOLS.map(pool => [pool.level, pool.words.length])).toEqual([['A1',898],['A2',793],['B1',691],['B2',1297],['C1',1278],['C2',942]]);
    for (const pool of CEFR_POOLS) {
      expect(new Set(pool.words.map(word => word.term)).size).toBe(pool.words.length);
      for (const word of pool.words) expect(Object.keys(word).sort()).toEqual(['partsOfSpeech','term']);
    }
  });
  it('resolves matching parts of speech without borrowing unrelated meanings', () => {
    const word = { term: 'cover', partsOfSpeech: ['verb'] };
    const dictionary = { term: 'cover', senses: [{ partOfSpeech: 'noun', definitions: ['A lid.'] }, { partOfSpeech: 'verb', definitions: ['To place over something.'] }] };
    expect(resolvePoolWord(word, dictionary)).toMatchObject({ senses: [dictionary.senses[1]], available: true });
    expect(resolvePoolWord(word, { term: 'cover', senses: [dictionary.senses[0]!] })).toMatchObject({ senses: [], available: false });
  });
});
