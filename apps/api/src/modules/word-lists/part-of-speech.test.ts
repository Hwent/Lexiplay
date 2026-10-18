import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { WordListRepository } from './word-list.repository';
import { WordListsService } from './word-lists.service';

describe('part-of-speech lookup', () => {
  const repository = new WordListRepository();
  const service = new WordListsService(repository);
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => repository.onModuleDestroy());

  it('returns dictionary word classes without including the answer or definitions', async () => {
    const lookup = vi.spyOn(repository, 'poolDictionaryEntries').mockResolvedValue([
      { id: 'cover', term: 'cover', partOfSpeech: ['noun', 'verb', 'noun'], senses: [] },
    ]);
    expect(await service.dictionaryPartOfSpeech('cover')).toBe('noun · verb');
    expect(lookup).toHaveBeenCalledExactlyOnceWith(['cover']);
  });

  it('reports unavailable word classes instead of inventing a hint', async () => {
    const lookup = vi.spyOn(repository, 'poolDictionaryEntries').mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'apple', term: 'apple', partOfSpeech: ['unknown', ''], senses: [] }]);
    expect(await service.dictionaryPartOfSpeech('missing')).toBeUndefined();
    expect(await service.dictionaryPartOfSpeech('apple')).toBeUndefined();
    lookup.mockRejectedValueOnce(new Error('Dictionary unavailable'));
    await expect(service.dictionaryPartOfSpeech('apple')).rejects.toThrow('Dictionary unavailable');
  });
});
