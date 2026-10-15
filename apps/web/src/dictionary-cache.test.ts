import { afterEach, describe, expect, it, vi } from 'vitest';
import { cachedDictionaryDefinition, clearDictionaryCache, dictionaryDefinition, rememberDictionaryDefinition, searchDictionary } from './dictionary-cache';

describe('shared browser dictionary cache', () => {
  afterEach(() => {
    clearDictionaryCache();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shares simultaneous requests and normalizes repeated searches and definitions', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(
      String(input).includes('?q=')
        ? [{ term: 'apple', partOfSpeech: ['noun'] }, { term: 'apple', partOfSpeech: ['noun'] }]
        : { definition: 'A fruit.' },
    )));
    vi.stubGlobal('fetch', fetchMock);
    const [first, second] = await Promise.all([searchDictionary(' APPLE '), searchDictionary('apple')]);
    expect(first).toEqual([{ term: 'apple', partOfSpeech: ['noun'] }]);
    expect(second).toEqual(first);
    await searchDictionary('Apple');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await Promise.all([dictionaryDefinition(' apple '), dictionaryDefinition('apple')])).toEqual(['A fruit.', 'A fruit.']);
    expect(await dictionaryDefinition('apple')).toBe('A fruit.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('preserves case-distinct source entries and definitions', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => Response.json(
      String(input).includes('?q=') ? [{ term: 'Polish', partOfSpeech: ['adjective'] }, { term: 'polish', partOfSpeech: ['verb'] }]
        : { definition: String(input).includes('/Polish/') ? 'From Poland.' : 'To shine.' }
    )));
    expect((await searchDictionary('polish')).map(word => word.term)).toEqual(['Polish', 'polish']);
    expect(await dictionaryDefinition('Polish')).toBe('From Poland.');
    expect(await dictionaryDefinition('polish')).toBe('To shine.');
  });

  it('restores cached data after a page reload without calling the API', async () => {
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { term: 'apple', partOfSpeech: ['noun'], definition: 'A fruit.' },
      { term: 'pineapple', partOfSpeech: ['noun'], definition: 'A tropical fruit.' },
      { term: 'crabapple', partOfSpeech: ['noun'], definition: '   ' },
    ])));
    vi.stubGlobal('fetch', fetchMock);
    await searchDictionary('apple');
    expect(writes).toHaveBeenCalledTimes(1);
    expect(cachedDictionaryDefinition('crabapple')).toBeUndefined();
    vi.resetModules();
    const reloaded = await import('./dictionary-cache');
    expect(await reloaded.searchDictionary('apple')).toHaveLength(3);
    expect(await reloaded.dictionaryDefinition('apple')).toBe('A fruit.');
    expect(await reloaded.dictionaryDefinition('pineapple')).toBe('A tropical fruit.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    reloaded.clearDictionaryCache();
  });

  it('refreshes expired entries through the API after 24 hours', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(
      String(input).includes('?q=') ? [] : { definition: 'A refreshed fruit.' },
    )));
    vi.stubGlobal('fetch', fetchMock);
    await searchDictionary('apple');
    rememberDictionaryDefinition('apple', 'The old fruit.');
    clock.mockReturnValue(1000 + 24 * 60 * 60 * 1000);
    expect(cachedDictionaryDefinition('apple')).toBeUndefined();
    expect(await dictionaryDefinition('apple')).toBe('A refreshed fruit.');
    await searchDictionary('apple');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries failed requests and does not cache empty definitions', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Try again.' }), { status: 429 }))
      .mockResolvedValueOnce(new Response('[]'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ definition: '' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ definition: 'A fruit.' })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(searchDictionary('apple')).rejects.toThrow('Try again.');
    expect(await searchDictionary('apple')).toEqual([]);
    expect(await dictionaryDefinition('apple')).toBe('');
    expect(await dictionaryDefinition('apple')).toBe('A fruit.');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('keeps case-distinct definitions separate and discards responses from an older dictionary revision', async () => {
    rememberDictionaryDefinition('Polish', 'From Poland.');
    rememberDictionaryDefinition('polish', 'To make shiny.');
    expect(cachedDictionaryDefinition('Polish')).toBe('From Poland.');
    expect(cachedDictionaryDefinition('polish')).toBe('To make shiny.');
    let respond!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { respond = resolve; })));
    const old = dictionaryDefinition('apple');
    clearDictionaryCache();
    respond(Response.json({ definition: 'Old meaning.' }));
    await old;
    expect(cachedDictionaryDefinition('apple')).toBeUndefined();
  });

  it('continues to cache in memory when browser storage is disabled', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage disabled'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage disabled'); });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ term: 'apple', partOfSpeech: ['noun'], definition: 'A fruit.' }])));
    vi.stubGlobal('fetch', fetchMock);
    expect(await searchDictionary('apple')).toHaveLength(1);
    expect(await dictionaryDefinition('apple')).toBe('A fruit.');
    expect(await dictionaryDefinition('apple')).toBe('A fruit.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
