import { afterEach, describe, expect, it, vi } from 'vitest';
import { CEFR_POOLS, resolvePoolWord } from './cefr-pools';
import { CefrPoolsService } from './cefr-pools.service';
import { WordListRepository } from './word-list.repository';
import { AccountService } from '../accounts/account.service';

const resources: { onModuleDestroy(): Promise<void> }[] = [];
afterEach(async () => { await Promise.all(resources.splice(0).map(resource => resource.onModuleDestroy())); vi.restoreAllMocks(); });
function service(rows: { term: string; senses: { partOfSpeech: string; definitions: string[] }[] }[]) {
  const dictionary = new WordListRepository();
  vi.spyOn(dictionary, 'poolDictionaryEntries').mockResolvedValue(rows);
  const pools = new CefrPoolsService({} as AccountService, dictionary);
  resources.push(dictionary, pools);
  return pools;
}
describe('Oxford CEFR gaming pools', () => {
  it('ships the five supplied levels with unique words, author and no definitions', () => {
    expect(CEFR_POOLS.map(pool => [pool.level, pool.words.length])).toEqual([['A1',898],['A2',793],['B1',691],['B2',1297],['C1',1278]]);
    for (const pool of CEFR_POOLS) {
      expect(pool.author).toBe('oxford_3000_5000');
      expect(new Set(pool.words.map(word => word.term)).size).toBe(pool.words.length);
      for (const word of pool.words) { expect(Object.keys(word).sort()).toEqual(['partsOfSpeech','term']); expect(word.partsOfSpeech.length).toBeGreaterThan(0); }
    }
  });
  it('resolves the source part of speech rather than using unrelated dictionary senses', () => {
    const word = { term: 'cover', partsOfSpeech: ['verb'] };
    const dictionary = { term: 'cover', senses: [{ partOfSpeech: 'noun', definitions: ['A lid.'] }, { partOfSpeech: 'verb', definitions: ['To place over something.'] }] };
    expect(resolvePoolWord(word, dictionary)).toMatchObject({ definition: 'To place over something.', senses: [dictionary.senses[1]], available: true });
    expect(resolvePoolWord(word, { term: 'cover', senses: [dictionary.senses[0]!] })).toMatchObject({ definition: '', senses: [], available: false });
  });
  it('hydrates definitions from the current dictionary on every open', async () => {
    const pools = service([{ term: 'cover', senses: [{ partOfSpeech: 'verb', definitions: ['To place over something.'] }] }]);
    const details = await pools.details('oxford-a2');
    expect(details.words.find(word => word.term === 'cover')?.definition).toBe('To place over something.');
    expect(details.words.find(word => word.term === 'per')?.available).toBe(false);
  });
  it('restricts game answers to dictionary-backed words of the selected length and never broadens an empty pool', async () => {
    const pools = service([{ term: 'apple', senses: [{ partOfSpeech: 'noun', definitions: ['A fruit.'] }] }, { term: 'ice cream', senses: [{ partOfSpeech: 'noun', definitions: ['A dessert.'] }] }]);
    expect(await pools.gameWords('oxford-a1',5)).toEqual(['apple']);
    await expect(pools.gameWords('oxford-a1',9)).rejects.toThrow('no dictionary-backed words');
    await expect(pools.details('invented-c2')).rejects.toThrow('not found');
  });
});
