import { afterEach, expect, it, vi } from 'vitest';
import { LibraryRequests } from './library-requests';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('shares simultaneous reads and serves a cache hit without another request', async () => {
  const fetchMock = vi.fn(async () => Response.json({ terms: ['cover'] })); vi.stubGlobal('fetch', fetchMock);
  const cache = new LibraryRequests();
  const first = cache.get('/word-lists/saved-terms'), second = cache.get('/word-lists/saved-terms');
  expect(first).toBe(second);
  await Promise.all([first, second]); await cache.get('/word-lists/saved-terms');
  expect(fetchMock).toHaveBeenCalledOnce();
});
it('expires cached reads and isolates separate account caches', async () => {
  vi.useFakeTimers(); const fetchMock = vi.fn(async () => Response.json([])); vi.stubGlobal('fetch', fetchMock);
  const cache = new LibraryRequests(); await cache.get('/word-lists/mine', 1000);
  vi.advanceTimersByTime(1001); await cache.get('/word-lists/mine', 1000);
  await new LibraryRequests().get('/word-lists/mine'); expect(fetchMock).toHaveBeenCalledTimes(3);
});
it('does not put a stale in-flight response back into an invalidated cache', async () => {
  let finish!: (response: Response) => void;
  const fetchMock = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })); vi.stubGlobal('fetch', fetchMock);
  const cache = new LibraryRequests(); const request = cache.get('/word-lists/mine');
  cache.invalidate('/word-lists'); finish(Response.json(['old'])); await request;
  expect(cache.peek('/word-lists/mine')).toBeUndefined();
});
it('retries failed reads instead of caching the error', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ message: 'Offline' }, { status: 503 })).mockResolvedValueOnce(Response.json([])); vi.stubGlobal('fetch', fetchMock);
  const cache = new LibraryRequests(); await expect(cache.get('/word-lists/mine')).rejects.toThrow('Offline');
  await expect(cache.get('/word-lists/mine')).resolves.toEqual([]); expect(fetchMock).toHaveBeenCalledTimes(2);
});
