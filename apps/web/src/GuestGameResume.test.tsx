import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';

beforeEach(() => { localStorage.clear(); history.replaceState({}, '', '/games'); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each([null, 'stale-game'])('recovers the guest active game when the local game ID is %s', async localId => {
  if (localId) localStorage.setItem('lexiplay-last-game', localId);
  const game = { id: 'guest-active', wordLength: 5, difficulty: 'medium', attemptLimit: 6, guesses: [{ guess: 'crane', feedback: ['ABSENT', 'ABSENT', 'PRESENT', 'ABSENT', 'ABSENT'] }], hints: { definition: 1 }, revealedAbsent: [], revealedPresent: [], status: 'active' };
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/auth/me')) return new Response('{}', { status: 401 });
    if (path.endsWith('/games/wallet')) return Response.json({ coinBalance: 9, kind: 'guest', activeGameId: game.id });
    if (path.endsWith('/games/stale-game')) return new Response('{}', { status: 404 });
    if (path.endsWith(`/games/${game.id}`)) return Response.json(game);
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<App/>);
  expect(await screen.findByRole('grid', { name: '5-letter puzzle board' })).toBeInTheDocument();
  expect(screen.getByRole('row', { name: 'crane' })).toBeInTheDocument();
  await waitFor(() => expect(localStorage.getItem('lexiplay-last-game')).toBe(game.id));
  expect(screen.getByRole('button', { name: 'Give up' })).toBeEnabled();
  expect(fetchMock.mock.calls.some(([path]) => String(path).endsWith('/games'))).toBe(false);
});

it('discards a guest game that cannot be found and returns to new-game setup', async () => {
  localStorage.setItem('lexiplay-last-game', 'missing-game');
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/auth/me')) return new Response('{}', { status: 401 });
    if (path.endsWith('/games/wallet')) return Response.json({ coinBalance: 9, kind: 'guest', activeGameId: 'missing-game' });
    if (path.endsWith('/games/missing-game')) return new Response('{}', { status: 404 });
    return Response.json([]);
  }));
  render(<App/>);
  await waitFor(() => expect(screen.getByRole('button', { name: /start practice/i })).toBeEnabled());
  expect(localStorage.getItem('lexiplay-last-game')).toBeNull();
  expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  expect(screen.queryByText('Could not restore your puzzle. Reload to try again.')).not.toBeInTheDocument();
});
