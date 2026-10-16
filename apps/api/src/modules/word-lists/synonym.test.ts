import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { WordListRepository } from './word-list.repository';
import { WordListsService } from './word-lists.service';

describe('online synonym lookup', () => {
  const repository = new WordListRepository();
  const service = new WordListsService(repository);
  afterEach(() => vi.unstubAllGlobals());
  afterAll(() => repository.onModuleDestroy());

  it('uses the synonym relation and excludes the answer from the clue', async () => {
    const lookup = vi.fn().mockResolvedValue(Response.json([{ word: 'happy' }, { word: 'happy person' }, { word: 'cheerful' }]));
    vi.stubGlobal('fetch', lookup);
    expect(await service.dictionarySynonym('happy')).toBe('cheerful');
    expect(lookup).toHaveBeenCalledWith('https://api.datamuse.com/words?rel_syn=happy&max=10', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('uses a category when the word has no synonym', async () => {
    const lookup = vi.fn().mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(Response.json([{ word: 'fruit' }]));
    vi.stubGlobal('fetch', lookup);
    expect(await service.dictionarySynonym('apple')).toBe('Category: fruit');
    expect(lookup).toHaveBeenLastCalledWith('https://api.datamuse.com/words?rel_spc=apple&max=10', expect.anything());
  });

  it('reports missing clues and network failures without inventing a clue', async () => {
    const lookup = vi.fn().mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(Response.json([])).mockRejectedValueOnce(new Error('Offline'));
    vi.stubGlobal('fetch', lookup);
    expect(await service.dictionarySynonym('apple')).toBeUndefined();
    await expect(service.dictionarySynonym('happy')).rejects.toThrow('No coins were charged');
  });
});
