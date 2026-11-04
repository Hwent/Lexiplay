import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { queueAnimalPractice, syncAnimalPractice } from './practice-progress';

const round = { roundId: 'b7c83c99-47b0-4cd7-987a-3925458f0302', status: 'won' as const, questionCount: 8, guessCount: 1, completedAt: '2026-10-28T12:00:00.000Z' };
beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

it('deduplicates pending rounds and retries failed requests with the same round ID', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(Response.json({ recorded: true }));
  vi.stubGlobal('fetch', fetch);
  queueAnimalPractice(round, 'guest');
  queueAnimalPractice(round, 'guest');
  await syncAnimalPractice('guest');
  await syncAnimalPractice('guest');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual(round);
  expect(localStorage.getItem('lexiplay-animal-practice-pending')).toBe('[]');
});

it('binds guest progress to the first account and does not send another account’s rounds', async () => {
  const fetch = vi.fn().mockRejectedValue(new Error('Offline'));
  vi.stubGlobal('fetch', fetch);
  queueAnimalPractice(round, 'guest');
  await syncAnimalPractice('account-a');
  await syncAnimalPractice('account-b');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(localStorage.getItem('lexiplay-animal-practice-pending')!)[0].owner).toBe('account-a');
});
