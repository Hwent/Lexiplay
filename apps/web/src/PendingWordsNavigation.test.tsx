import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { clearDictionaryCache } from './dictionary-cache';

const account = { id: 'learner', username: 'test', email: null };
const list = { id: 'my-list', isDefault: true, preferredLanguage: 'en', wordCount: 0 };
const game = { id: 'saved-game', wordLength: 5, attemptLimit: 6, guesses: [{ guess: 'cover', definition: 'To place over.', feedback: Array(5).fill('ABSENT'), completed: false, attemptsRemaining: 5 }], hints: { synonym: 1, definition: 1 }, revealedAbsent: [], revealedPresent: [] };
beforeEach(() => { localStorage.clear(); window.history.replaceState({}, '', '/games'); });
afterEach(() => { cleanup(); clearDictionaryCache(); vi.unstubAllGlobals(); });
function apiFixture(write?: (init: RequestInit) => Promise<Response>) {
  const saved: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith('/auth/me')) return Response.json(account);
    if (path.endsWith('/games/saved-game')) return Response.json(game);
    if (path.endsWith('/saved-terms')) return Response.json({ terms: saved });
    if (path.endsWith('/mine')) return Response.json([list]);
    if (path.includes('/dictionary?q=')) return Response.json([{ term: 'cover', partOfSpeech: ['verb'], senses: [{ partOfSpeech: 'verb', definitions: ['To place over.'] }] }]);
    if (path.includes('/entries?')) return Response.json({ list, page: 1, pageSize: 25, total: 0, words: [] });
    if (path.endsWith('/dictionary-entries')) {
      if (write) return write(init!);
      const terms = JSON.parse(String(init?.body)).terms as string[];
      saved.push(...terms); return Response.json({ added: terms.length, skipped: 0, missing: [] });
    }
    return Response.json([]);
  }); vi.stubGlobal('fetch', fetchMock); return fetchMock;
}
it('lets game additions be canceled and never writes a canceled selection on exit', async () => {
  localStorage.setItem('lexiplay-last-game', game.id); const fetchMock = apiFixture();
  const user = userEvent.setup(); render(<App/>);
  const add = await screen.findByRole('button', { name: 'Add cover to word list' }); await waitFor(() => expect(add).toBeEnabled());
  await user.click(add); await user.click(screen.getByRole('button', { name: 'Cancel addition of cover' }));
  await user.click(screen.getByRole('button', { name: 'Home' }));
  expect(window.location.pathname).toBe('/');
  expect(fetchMock.mock.calls.some(([path]) => String(path).endsWith('/dictionary-entries'))).toBe(false);
});
it('waits for the exit batch before navigation, then shows the committed Saved state without refetching membership', async () => {
  let finish!: (response: Response) => void;
  localStorage.setItem('lexiplay-last-game', game.id);
  const fetchMock = apiFixture(() => new Promise(resolve => { finish = resolve; }));
  const user = userEvent.setup(); render(<App/>);
  const add = await screen.findByRole('button', { name: 'Add cover to word list' }); await waitFor(() => expect(add).toBeEnabled());
  await user.click(add); expect(fetchMock.mock.calls.some(([path]) => String(path).endsWith('/dictionary-entries'))).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Home' })); await waitFor(() => expect(finish).toBeDefined());
  expect(window.location.pathname).toBe('/games'); expect(screen.getByText(/1 word selected/).closest('[role="status"]')).toHaveAttribute('aria-busy', 'true');
  await act(async () => { finish(Response.json({ added: 1, skipped: 0, missing: [] })); });
  await waitFor(() => expect(window.location.pathname).toBe('/'));
  await user.click(screen.getByRole('button', { name: 'Games' }));
  expect(screen.getByRole('button', { name: 'Already in word list' })).toBeDisabled();
  expect(fetchMock.mock.calls.filter(([path]) => String(path).endsWith('/saved-terms'))).toHaveLength(1);
});
it('keeps the current page and pending selection when an exit write fails, then retries safely', async () => {
  let offline = true; localStorage.setItem('lexiplay-last-game', game.id);
  const fetchMock = apiFixture(async () => offline ? Response.json({ message: 'Offline' }, { status: 503 }) : Response.json({ added: 1, skipped: 0, missing: [] }));
  const user = userEvent.setup(); render(<App/>);
  const add = await screen.findByRole('button', { name: 'Add cover to word list' }); await waitFor(() => expect(add).toBeEnabled());
  await user.click(add); await user.click(screen.getByRole('button', { name: 'Home' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Your selections are still pending');
  expect(window.location.pathname).toBe('/games'); expect(screen.getByRole('button', { name: 'Cancel addition of cover' })).toBeEnabled();
  offline = false; await user.click(screen.getByRole('button', { name: 'Home' })); await waitFor(() => expect(window.location.pathname).toBe('/'));
  expect(fetchMock.mock.calls.filter(([path]) => String(path).endsWith('/dictionary-entries'))).toHaveLength(2);
});
it('keeps dictionary additions cancellable across tools remounts and saves only when leaving the library', async () => {
  window.history.replaceState({}, '', '/library'); const fetchMock = apiFixture();
  const user = userEvent.setup(); render(<App/>);
  await user.click(await screen.findByRole('tab', { name: 'My Word List' })); await user.click(await screen.findByRole('button', { name: 'Open dictionary tools' }));
  await user.type(screen.getByRole('searchbox', { name: 'Search the dictionary' }), 'cover');
  await user.click(await screen.findByRole('button', { name: 'Add cover' }));
  await user.click(screen.getByRole('button', { name: 'Close dictionary tools' })); await user.click(screen.getByRole('button', { name: 'Open dictionary tools' }));
  await user.type(screen.getByRole('searchbox', { name: 'Search the dictionary' }), 'cover');
  expect(await screen.findByRole('button', { name: 'Cancel addition of cover' })).toBeEnabled();
  expect(fetchMock.mock.calls.some(([path]) => String(path).endsWith('/dictionary-entries'))).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Home' })); await waitFor(() => expect(window.location.pathname).toBe('/'));
  expect(fetchMock.mock.calls.filter(([path]) => String(path).endsWith('/dictionary-entries'))).toHaveLength(1);
  expect(fetchMock.mock.calls.filter(([path]) => String(path).endsWith('/mine'))).toHaveLength(1);
});
