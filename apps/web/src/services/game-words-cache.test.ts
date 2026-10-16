import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GameWordsCache } from './game-words-cache';

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

it('shares downloads and reuses the accepted words across games and page reloads', async () => {
  const fetch = vi.fn(async () => Response.json({ version: 'one', wordLength: 5, words: ['apple', 'crane'] }));
  vi.stubGlobal('fetch', fetch);
  const cache = new GameWordsCache();
  expect(cache.allows('zzzzz', 'one')).toBeUndefined();
  await Promise.all([cache.load(5, 'one'), cache.load(5, 'one')]);
  await cache.load(5, 'one');
  expect(cache.allows('apple', 'one')).toBe(true);
  expect(cache.allows('zzzzz', 'one')).toBe(false);
  const reopened = new GameWordsCache();
  await reopened.load(5, 'one');
  expect(reopened.allows('crane', 'one')).toBe(true);
  expect(fetch).toHaveBeenCalledOnce();
});

it('refreshes on dictionary revisions and keeps word lengths separate', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ version: 'one', wordLength: 5, words: ['apple'] }))
    .mockResolvedValueOnce(Response.json({ version: 'two', wordLength: 5, words: ['crane'] }))
    .mockResolvedValueOnce(Response.json({ version: 'two', wordLength: 3, words: ['cat'] }));
  vi.stubGlobal('fetch', fetch);
  const cache = new GameWordsCache();
  await cache.load(5, 'one');
  expect(cache.allows('crane', 'two')).toBeUndefined();
  await cache.load(5, 'two');
  await cache.load(3, 'two');
  expect(cache.allows('apple', 'two')).toBe(false);
  expect(cache.allows('crane', 'two')).toBe(true);
  expect(cache.allows('cat', 'two')).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('leaves validation to the server after failures or a mismatched revision and allows retry', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce(Response.json({ version: 'old', wordLength: 5, words: ['apple'] }))
    .mockResolvedValueOnce(Response.json({ version: 'new', wordLength: 5, words: ['crane'] })));
  const cache = new GameWordsCache();
  await expect(cache.load(5, 'new')).rejects.toThrow('Offline');
  expect(cache.allows('crane', 'new')).toBeUndefined();
  await cache.load(5, 'new');
  expect(cache.allows('crane', 'new')).toBeUndefined();
  await cache.load(5, 'new');
  expect(cache.allows('crane', 'new')).toBe(true);
});
