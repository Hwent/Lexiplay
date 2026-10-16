import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { stubFetchWithVocabularyRanges } from './vocabulary-range-test-fixtures';

beforeEach(() => { localStorage.clear(); history.replaceState({}, '', '/games'); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('rejects invalid words locally, keeps server validation, and reuses the cache for Play again', async () => {
  let starts = 0;
  const downloads = vi.fn(async () => Response.json({ version: 'one', wordLength: 5, words: ['apple', 'crane'] }));
  const guesses = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const { guess } = JSON.parse(String(init?.body));
    if (guess === 'crane') return Response.json({ code: 'INVALID_GUESS', message: 'Dictionary changed.' }, { status: 400 });
    return Response.json({ guess, feedback: Array(5).fill('CORRECT'), attemptsRemaining: 5, completed: true, outcome: 'WON', answer: guess });
  });
  stubFetchWithVocabularyRanges(vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith('/auth/me')) return new Response('{}', { status: 401 });
    if (path.includes('/dictionary/game-words?')) return downloads();
    if (path.endsWith('/guesses')) return guesses(input, init);
    if (path.endsWith('/games') && init?.method === 'POST') return Response.json({
      id: `game-${++starts}`, wordLength: 5, difficulty: 'medium', attemptLimit: 6, guesses: [],
      hints: { synonym: 1, definition: 1 }, revealedAbsent: [], revealedPresent: [],
    });
    return Response.json([]);
  }));
  // The range fixture normally supplies an empty revision response.
  const fetch = globalThis.fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith('/library/revision')
    ? Promise.resolve(Response.json({ version: 'one' })) : fetch(input, init));
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() => expect(screen.getByRole('button', { name: /start practice/i })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: /start practice/i }));
  await screen.findByRole('textbox', { name: /five-letter guess/i });
  await waitFor(() => expect(localStorage.getItem('lexiplay-game-words:5')).not.toBeNull());
  await user.keyboard('zzzzz');
  expect(screen.getByText(/ZZZZZ is not in the dictionary/)).toBeInTheDocument();
  expect(screen.getByText('6 guesses left')).toBeInTheDocument();
  expect(guesses).not.toHaveBeenCalled();
  await user.keyboard('{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}crane');
  expect(await screen.findByText(/CRANE is not in the dictionary/)).toBeInTheDocument();
  expect(guesses).toHaveBeenCalledOnce();
  expect(screen.getByText('6 guesses left')).toBeInTheDocument();
  await user.keyboard('{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}apple');
  await user.click(await screen.findByRole('button', { name: 'Play again' }));
  await screen.findByRole('textbox', { name: /five-letter guess/i });
  await user.keyboard('zzzzz');
  expect(screen.getByText(/ZZZZZ is not in the dictionary/)).toBeInTheDocument();
  expect(guesses).toHaveBeenCalledTimes(2);
  expect(downloads).toHaveBeenCalledOnce();
});
