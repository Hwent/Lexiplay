import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';

beforeEach(() => { localStorage.clear(); localStorage.setItem('lexiplay-guess-animal-invitation-seen', 'true'); history.replaceState({}, '', '/'); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('resolves the request owner before loading statistics and checking the library revision', async () => {
  history.replaceState({}, '', '/progress');
  localStorage.setItem('lexiplay-library-revision', 'stable');
  let finishAccount!: (response: Response) => void;
  const account = new Promise<Response>(resolve => { finishAccount = resolve; });
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/auth/me')) return account;
    if (path.endsWith('/library/revision')) return Response.json({ version: 'stable' });
    if (path.includes('/progress/summary')) return Response.json({ total: 0, recent: [] });
    if (path.endsWith('/word-lists/saved-terms')) return Response.json({ terms: [] });
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);
  await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => String(path).endsWith('/auth/me'))).toBe(true));
  const requests = (part: string) => fetchMock.mock.calls.filter(([path]) => String(path).includes(part));
  expect(requests('/progress/summary')).toHaveLength(0);
  expect(requests('/library/revision')).toHaveLength(0);
  await act(async () => { finishAccount(Response.json({ id: 'learner', username: 'learner', coinBalance: 12, activeGameId: null })); });
  expect(await screen.findByText('Your first word starts the story.')).toBeInTheDocument();
  expect(requests('/progress/summary')).toHaveLength(1);
  expect(requests('/library/revision')).toHaveLength(1);
});

it('uses the authenticated bootstrap wallet without requesting it again', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/auth/me')) return Response.json({ id: 'learner', username: 'learner', coinBalance: 12, activeGameId: null });
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);
  expect(await screen.findByLabelText('Coin balance: 12')).toBeInTheDocument();
  await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => String(path).endsWith('/collections/game-options/all'))).toBe(true));
  expect(fetchMock.mock.calls.some(([path]) => String(path).endsWith('/games/wallet'))).toBe(false);
});

it('shares the saved-game and authenticated active-game recovery request', async () => {
  localStorage.setItem('lexiplay-last-game', 'saved-game');
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  let gameReads = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/auth/me')) return Response.json({ id: 'learner', username: 'learner', coinBalance: 12, activeGameId: 'saved-game' });
    if (path.endsWith('/games/saved-game')) { gameReads++; return pending; }
    return Response.json([]);
  }));
  render(<App />);
  expect(await screen.findByLabelText('Coin balance: 12')).toBeInTheDocument();
  expect(gameReads).toBe(1);
  finish(Response.json({ id: 'saved-game', wordLength: 5, attemptLimit: 6, guesses: [], hints: { definition: 1 }, clues: {}, revealedAbsent: [], revealedPresent: [], wallet: { coinBalance: 12, kind: 'account' } }));
  await userEvent.setup().click(screen.getByRole('button', { name: 'Games' }));
  expect(await screen.findByRole('grid', { name: '5-letter puzzle board' })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('region', { name: 'Vocabulary puzzle' })).toHaveAttribute('aria-busy', 'false'));
  expect(gameReads).toBe(1);
});

it('prefetches every word count before opening setup and reuses them across lengths', async () => {
  const counts = vi.fn(async () => Response.json(Array.from({ length: 7 }, (_, index) => ({ wordLength: index + 3, totalWords: (index + 3) * 10, collections: [] }))));
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/auth/me')) return Response.json({}, { status: 401 });
    if (path.endsWith('/games/wallet')) return Response.json({ coinBalance: 10, kind: 'guest' });
    if (path.endsWith('/collections/game-options/all')) return counts();
    return Response.json({});
  }));
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() => expect(counts).toHaveBeenCalledOnce());
  await user.click(screen.getByRole('button', { name: 'Games' }));
  const setup = screen.getByRole('region', { name: 'Vocabulary puzzle' });
  const count = screen.getByLabelText('Playable words');
  expect(screen.getByLabelText('Playable words')).toHaveTextContent('50 words');
  for (const length of [3, 9, 4, 7, 6, 8, 5]) {
    await user.click(screen.getByRole('radio', { name: `${length} letters` }));
    expect(screen.getByLabelText('Playable words')).toHaveTextContent(`${length * 10} words`);
    expect(screen.getByLabelText('Playable words')).toBe(count);
    expect(screen.getByRole('region', { name: 'Vocabulary puzzle' })).toBe(setup);
    expect(location.pathname).toBe('/games');
  }
  expect(counts).toHaveBeenCalledOnce();
});

it('limits revision checks during navigation and checks again after the throttle window', async () => {
  const revisions = vi.fn().mockImplementationOnce(async () => Response.json({ version: 'first' }))
    .mockImplementation(async () => Response.json({ version: 'second' }));
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/auth/me')) return Response.json({}, { status: 401 });
    if (path.endsWith('/games/wallet')) return Response.json({ coinBalance: 10, kind: 'guest' });
    if (path.endsWith('/library/revision')) return revisions();
    return Response.json([]);
  }));
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() => expect(localStorage.getItem('lexiplay-library-revision')).toBe('first'));
  for (const name of ['Games', 'Home', 'Games', 'Home']) await user.click(name === 'Home' ? screen.getByRole('link', { name: 'LexiPlay home' }) : screen.getByRole('button', { name }));
  expect(revisions).toHaveBeenCalledOnce();
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_001);
  await user.click(screen.getByRole('button', { name: 'Games' }));
  await waitFor(() => expect(localStorage.getItem('lexiplay-library-revision')).toBe('second'));
  expect(revisions).toHaveBeenCalledTimes(2);
});

it('loads the signed-in word list before navigation and reuses the first page', async () => {
  const list = { id: 'learner', name: 'My Word List', preferredLanguage: 'en', isDefault: true, wordCount: 1 };
  const entries = vi.fn(async () => Response.json({ list, total: 1, page: 1, pageSize: 25,
    words: [{ id: 'word', lemma: 'apple', definition: 'A fruit.', partOfSpeech: 'noun', familiarity: 0, stage: 'Core', nextReviewAt: null }] }));
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/auth/me')) return Response.json({ id: 'learner', username: 'learner' });
    if (path.endsWith('/word-lists/mine')) return Response.json([list]);
    if (path.includes('/word-lists/mine/entries?')) return entries();
    if (path.endsWith('/word-lists/saved-terms')) return Response.json({ terms: [] });
    return Response.json([]);
  }));
  const user = userEvent.setup(); render(<App />);
  await waitFor(() => expect(entries).toHaveBeenCalledOnce());
  await user.click(screen.getByRole('button', { name: 'Words' }));
  await user.click(screen.getByRole('tab', { name: 'My Word List' }));
  expect(await screen.findByText('A fruit.')).toBeInTheDocument();
  expect(entries).toHaveBeenCalledOnce();
});

it('opens another page while statistics fetch is still pending', async () => {
  let requested = false;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/auth/me')) return Response.json({ id: 'learner', username: 'learner' });
    if (path.includes('/progress/summary')) {
      requested = true;
      return new Promise<Response>(() => {});
    }
    if (path.endsWith('/word-lists/saved-terms')) return Response.json({ terms: [] });
    return Response.json([]);
  }));
  const user = userEvent.setup(); render(<App />);
  await user.click(screen.getByRole('button', { name: 'Stats' }));
  await waitFor(() => expect(requested).toBe(true));
  expect(screen.getByRole('region', { name: 'Learning statistics' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  expect(location.pathname).toBe('/settings');
  expect(screen.getByRole('region', { name: 'Preferences' })).toBeInTheDocument();
});
