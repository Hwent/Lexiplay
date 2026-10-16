import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PendingWords } from './pending-words';
beforeEach(() => localStorage.clear());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function mockApi() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/saved-terms')) return Response.json({ terms: ['saved'] });
    if (String(input).endsWith('/mine')) return Response.json([{ id: 'my-list', isDefault: true, wordCount: 1 }]);
    if (!init?.method) return Response.json({ words: [] });
    return Response.json({ added: JSON.parse(String(init?.body)).terms.length, skipped: 0, missing: [] });
  }); vi.stubGlobal('fetch', fetchMock); return fetchMock;
}
it('adds and cancels dictionary and game selections without any writes, then saves one batch on exit', async () => {
  const fetchMock = mockApi(), store = new PendingWords('user-one'); await store.loadSaved();
  store.toggle('cover', '', 'my-list'); store.toggle(' cover '); store.toggle('paper', 'Writing material.'); store.toggle('cover', '', 'my-list');
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  expect(store.getSnapshot().saved.has('cover')).toBe(false);
  const first = store.flush(), second = store.flush(); expect(first).toBe(second); await first;
  const writes = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST'); expect(writes).toHaveLength(1);
  expect(JSON.parse(String(writes[0]![1]?.body))).toEqual({ terms: ['paper', 'cover'] });
  expect(store.getSnapshot().pending.size).toBe(0); expect(store.getSnapshot().saved.has('cover')).toBe(true);
});
it('does not write a canceled addition or remove an already saved word', async () => {
  const fetchMock = mockApi(), store = new PendingWords('user-one'); await store.loadSaved();
  store.toggle('saved'); store.toggle('cover'); store.toggle('cover'); await store.flush();
  expect(store.getSnapshot().saved.has('saved')).toBe(true);
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});
it('keeps failed selections for a retry and invalidates reads only after a successful commit', async () => {
  const fetchMock = mockApi(), store = new PendingWords('user-one'); await store.loadSaved();
  await store.requests.get('/word-lists/mine'); store.toggle('cover', '', 'my-list');
  await store.requests.get('/word-lists/my-list/entries?page=1');
  fetchMock.mockResolvedValueOnce(Response.json({ message: 'Offline' }, { status: 503 }));
  await expect(store.flush()).rejects.toThrow('Offline'); expect(store.getSnapshot().pending.has('cover')).toBe(true);
  expect(store.getSnapshot().saved.has('cover')).toBe(false); expect(store.requests.peek('/word-lists/mine')).toBeDefined();
  await store.flush(); expect(store.requests.peek('/word-lists/my-list/entries?page=1')).toBeUndefined();
  expect(store.requests.peek('/word-lists/mine')).toEqual([{ id: 'my-list', isDefault: true, wordCount: 2 }]);
  const count = fetchMock.mock.calls.length; await store.loadSaved(); expect(fetchMock).toHaveBeenCalledTimes(count);
});
it('recovers pending selections after remount and keeps accounts isolated', () => {
  const first = new PendingWords('user-one'); first.toggle('cover', '', 'my-list');
  expect(new PendingWords('user-one').getSnapshot().pending.has('cover')).toBe(true);
  expect(new PendingWords('user-two').getSnapshot().pending.size).toBe(0);
});
it('reconciles recovered selections already committed by a background request without writing again', async () => {
  const store = new PendingWords('user-one'); store.toggle('cover', '', 'my-list');
  const fetchMock = vi.fn(async () => Response.json({ terms: ['cover'] })); vi.stubGlobal('fetch', fetchMock);
  const recovered = new PendingWords('user-one'); await recovered.flush();
  expect(recovered.getSnapshot().pending.size).toBe(0); expect(recovered.getSnapshot().saved.has('cover')).toBe(true);
  expect(fetchMock).toHaveBeenCalledOnce();
});
it('splits large batches at 200 and retains only the uncommitted batch after failure', async () => {
  const fetchMock = mockApi(), store = new PendingWords('user-one'); await store.loadSaved();
  const terms = Array.from({ length: 401 }, (_, index) => `word${index}`);
  store.stage(terms, 'my-list');
  fetchMock.mockResolvedValueOnce(Response.json({ added: 200, skipped: 0, missing: [] })).mockResolvedValueOnce(Response.json({ message: 'Offline' }, { status: 503 }));
  await expect(store.flush()).rejects.toThrow(); expect(store.getSnapshot().pending.size).toBe(201); expect(store.getSnapshot().saved.size).toBe(201);
  expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({ terms: terms.slice(0, 200) });
  expect(JSON.parse(String(fetchMock.mock.calls[2]![1]?.body))).toEqual({ terms: terms.slice(200, 400) });
  await store.flush(); expect(store.getSnapshot().pending.size).toBe(0);
  expect(JSON.parse(String(fetchMock.mock.calls[3]![1]?.body))).toEqual({ terms: terms.slice(200, 400) });
  expect(JSON.parse(String(fetchMock.mock.calls[4]![1]?.body))).toEqual({ terms: terms.slice(400) });
  expect(store.getSnapshot().saved.size).toBe(402);
});
it('never marks missing dictionary words as saved and uses keepalive for a browser exit', async () => {
  const fetchMock = mockApi(), store = new PendingWords('user-one'); await store.loadSaved(); store.toggle('unknown', '', 'my-list');
  fetchMock.mockResolvedValueOnce(Response.json({ added: 0, skipped: 0, missing: ['unknown'] })); await store.flush(true);
  expect(store.getSnapshot().saved.has('unknown')).toBe(false); expect(store.getSnapshot().notice).toContain('unknown');
  expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/word-lists/my-list/dictionary-entries', expect.objectContaining({ keepalive: true }));
});
it('keeps guest game additions pending until exit and allows canceling them', async () => {
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  const store = new PendingWords('guest'); await store.loadSaved(); store.toggle('cover', 'To place over.');
  expect(localStorage.getItem('lexiplay-local-word-lists')).toBeNull(); store.toggle('cover'); await store.flush();
  expect(localStorage.getItem('lexiplay-local-word-lists')).toBeNull();
  store.toggle('paper', 'Writing material.'); await store.flush();
  expect(localStorage.getItem('lexiplay-local-word-lists')).toContain('paper'); expect(fetchMock).not.toHaveBeenCalled();
});
it('keeps a visible recovery warning when browser draft storage is full', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage full'); });
  const store = new PendingWords('user-one'); store.toggle('cover', '', 'my-list');
  expect(store.getSnapshot().pending.has('cover')).toBe(true);
  expect(store.getSnapshot().error).toContain('Leave this page to save them before closing it');
});
