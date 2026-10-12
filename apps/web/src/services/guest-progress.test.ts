import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LAST_GAME_KEY, LOCAL_WORDS_KEY, TRANSFER_KEY, transferGuestProgress } from './guest-progress';

const accountId = '00000000-0000-4000-8000-000000000002';
const gameId = '00000000-0000-4000-8000-000000000003';
const apple = { id: 'local-1', term: 'apple', definition: 'A fruit.', status: 'KNOWN' };
function localWords(words: object[]) { window.localStorage.setItem(LOCAL_WORDS_KEY, JSON.stringify([{ id: 'local-list', name: 'My words', words }])); }
function response(wordsAdded = 1, gamesTransferred = 2) { return Response.json({ wordsAdded, wordsAlreadySaved: 0, gamesTransferred, resumeGameId: gameId }); }
describe('guest progress transfer', () => {
  beforeEach(() => window.localStorage.clear()); afterEach(() => vi.unstubAllGlobals());
  it('batches large lists, preserves statuses, and clears local words only after every batch succeeds', async () => {
    localWords(Array.from({ length: 205 }, (_, index) => ({ ...apple, id: `local-${index}`, term: `word${String.fromCharCode(97 + Math.floor(index / 26), 97 + index % 26)}` })));
    window.localStorage.setItem(LAST_GAME_KEY, gameId);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(window.localStorage.getItem(LOCAL_WORDS_KEY)).not.toBeNull();
      const body = JSON.parse(init!.body as string); expect(body.words.length).toBeLessThanOrEqual(100);
      expect(body.lastGameId).toBe(gameId); expect(body.words[0].status).toBe('KNOWN');
      return response(body.words.length, fetchMock.mock.calls.length === 1 ? 2 : 0);
    }); vi.stubGlobal('fetch', fetchMock);
    expect(await transferGuestProgress(accountId)).toMatchObject({ wordsAdded: 205, gamesTransferred: 2, resumeGameId: gameId });
    expect(fetchMock).toHaveBeenCalledTimes(3); expect(window.localStorage.getItem(LOCAL_WORDS_KEY)).toBeNull(); expect(window.localStorage.getItem(TRANSFER_KEY)).toBeNull();
  });
  it('keeps local data after a lost response and retries the same batch without switching accounts', async () => {
    localWords([apple]); window.localStorage.setItem(LAST_GAME_KEY, gameId);
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce(response()); vi.stubGlobal('fetch', fetchMock);
    await expect(transferGuestProgress(accountId)).rejects.toThrow('Connection lost');
    expect(window.localStorage.getItem(LOCAL_WORDS_KEY)).toContain('apple');
    await expect(transferGuestProgress('00000000-0000-4000-8000-000000000004')).rejects.toThrow('another account');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await transferGuestProgress(accountId);
    expect(fetchMock.mock.calls[0]![1].body).toBe(fetchMock.mock.calls[1]![1].body);
    expect(window.localStorage.getItem(TRANSFER_KEY)).toBeNull();
  });
  it('keeps words added or edited by another tab during migration', async () => {
    localWords([apple, { ...apple, id: 'local-2', term: 'paper' }]);
    vi.stubGlobal('fetch', vi.fn(async () => {
      localWords([{ ...apple, definition: 'An edited fruit.' }, { ...apple, id: 'local-2', term: 'paper' }, { ...apple, id: 'local-3', term: 'chair' }]);
      return response(2, 0);
    }));
    await transferGuestProgress(accountId);
    const remaining = JSON.parse(window.localStorage.getItem(LOCAL_WORDS_KEY)!)[0].words;
    expect(remaining.map((word: { term: string }) => word.term)).toEqual(['apple', 'chair']);
    expect(remaining[0].definition).toBe('An edited fruit.');
  });
  it('coalesces concurrent attempts and leaves malformed words untouched', async () => {
    localWords([apple]); const fetchMock = vi.fn(async () => response()); vi.stubGlobal('fetch', fetchMock);
    await Promise.all([transferGuestProgress(accountId), transferGuestProgress(accountId)]); expect(fetchMock).toHaveBeenCalledTimes(1);
    window.localStorage.setItem(LOCAL_WORDS_KEY, '{invalid-json');
    await expect(transferGuestProgress(accountId)).rejects.toThrow();
    expect(window.localStorage.getItem(LOCAL_WORDS_KEY)).toBe('{invalid-json'); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
