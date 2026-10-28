import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';

beforeEach(() => { localStorage.clear(); localStorage.setItem('lexiplay-guess-animal-invitation-seen', 'true'); history.replaceState({}, '', '/'); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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
    if (path.includes('/word-lists/learner/entries?')) return entries();
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
