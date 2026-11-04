import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { stubGameApiFetch } from './game-api-test-fixtures';

beforeEach(() => { localStorage.clear(); localStorage.setItem('lexiplay-guess-animal-invitation-seen', 'true'); history.replaceState({}, '', '/progress'); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('offers a puzzle instead of empty metrics and pagination before the first game', async () => {
  stubGameApiFetch(vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/auth/me')) return Response.json({ id: 'learner', username: 'learner' });
    if (path.includes('/progress/summary')) return Response.json({ total: 0, wins: 0, winRate: 0, streak: 0, recent: [], page: 1, pageSize: 10, totalPages: 1, timezone: 'America/Toronto' });
    return Response.json([]);
  }));
  const user = userEvent.setup(); render(<App/>);
  const start = await screen.findByRole('button', { name: 'Start a puzzle' });
  expect(screen.queryByText('Games played')).not.toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Recent practice pages' })).not.toBeInTheDocument();
  await user.click(start);
  expect(location.pathname).toBe('/games');
});

it('takes guests from their progress empty state to sign in', async () => {
  stubGameApiFetch(vi.fn(async () => new Response('{}', { status: 401 })));
  const user = userEvent.setup(); render(<App/>);
  await user.click(await screen.findByRole('button', { name: 'Sign in' }));
  expect(location.pathname).toBe('/account');
  expect(await screen.findByRole('textbox', { name: 'Username or email' })).toBeInTheDocument();
});

it('paginates practice with stable totals and saves selected recent words when leaving', async () => {
  let finishPage!: (response: Response) => void;
  const summary = { total: 11, wins: 8, losses: 3, winRate: 73, streak: 2, timezone: 'America/Toronto', distribution: [], pageSize: 10, totalPages: 2 };
  const game = { id: 'one', wordLength: 5, difficulty: 'medium', completedAt: '2026-10-15T12:00:00Z', answer: 'apple', answerDefinition: 'A fruit.', status: 'won', attemptCount: 2, coinChange: 4 };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith('/auth/me')) return Response.json({ id: 'learner', username: 'learner' });
    if (path.endsWith('/word-lists/saved-terms')) return Response.json({ terms: ['paper'] });
    if (path.endsWith('/word-lists/mine')) return Response.json([{ id: 'learner', isDefault: true }]);
    if (path.endsWith('/dictionary-entries') && init?.method === 'POST') return Response.json({ added: 1, skipped: 0, missing: [] });
    if (path.includes('/progress/summary')) {
      const page = Number(new URL(path, 'http://localhost').searchParams.get('page'));
      if (page === 2) return new Promise<Response>(resolve => { finishPage = resolve; });
      return Response.json({ ...summary, page: 1, recent: [game] });
    }
    return Response.json([]);
  });
  stubGameApiFetch(fetchMock);
  const user = userEvent.setup(); render(<App/>);
  await screen.findByRole('button', { name: 'Add apple to word list' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add apple to word list' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Add apple to word list' }));
  expect(screen.getByRole('button', { name: 'Cancel addition of apple' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByText('73%')).toBeInTheDocument();
  await waitFor(() => expect(finishPage).toBeDefined());
  finishPage(Response.json({ ...summary, page: 2, recent: [{ ...game, id: 'two', answer: 'paper' }] }));
  expect(await screen.findByText('Page 2 of 2')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'paper is already in your word list' })).toBeDisabled();
  const requests = fetchMock.mock.calls.filter(([path]) => String(path).includes('/progress/summary')).length;
  await user.click(screen.getByRole('button', { name: 'Previous' }));
  expect(await screen.findByRole('button', { name: 'Cancel addition of apple' })).toBeInTheDocument();
  expect(fetchMock.mock.calls.filter(([path]) => String(path).includes('/progress/summary'))).toHaveLength(requests);
  await user.click(screen.getByRole('button', { name: 'Words' }));
  await waitFor(() => expect(location.pathname).toBe('/library'));
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/word-lists/learner/dictionary-entries', expect.objectContaining({ body: JSON.stringify({ terms: ['apple'] }) }));
  expect(screen.queryByText(/1 word selected/)).not.toBeInTheDocument();
});
