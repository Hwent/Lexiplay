import { expect, it, vi } from 'vitest';
import { LibraryCache } from './library-cache';

it('shares concurrent work and reloads all keys after publication', async () => {
  const cache = new LibraryCache();
  const load = vi.fn(async () => ['apple']);
  const first = cache.get('five', 'v1', load);
  expect(cache.get('five', 'v1', load)).toBe(first);
  await first;
  await cache.get('five', 'v1', load);
  expect(load).toHaveBeenCalledOnce();
  await cache.get('six', 'v1', load);
  await cache.get('five', 'v2', load);
  await cache.get('six', 'v2', load);
  expect(load).toHaveBeenCalledTimes(4);
});

it('retries failures without letting an old failure remove a new revision', async () => {
  const cache = new LibraryCache();
  let reject!: (error: Error) => void;
  const old = cache.get('words', 'v1', () => new Promise<string[]>((_resolve, fail) => { reject = fail; }));
  const failed = expect(old).rejects.toThrow('Unavailable');
  const current = cache.get('words', 'v2', async () => ['cover']);
  cache.prime('words', 'v1', ['old']);
  reject(new Error('Unavailable'));
  await failed;
  expect(cache.get('words', 'v2', async () => [])).toBe(current);
  await expect(cache.get('retry', 'v2', async () => { throw new Error('Offline'); })).rejects.toThrow('Offline');
  await expect(cache.get('retry', 'v2', async () => ['paper'])).resolves.toEqual(['paper']);
});
