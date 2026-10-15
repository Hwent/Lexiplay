import { stubFetchWithVocabularyRanges } from './vocabulary-range-test-fixtures';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

describe('saved practice and account updates', () => {
  beforeEach(() => { window.localStorage.clear(); window.history.replaceState({}, '', '/games'); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  const emptyGame = { id: 'saved-game', wordLength: 9, difficulty: 'hard', attemptLimit: 5, guesses: [], hints: { unused: 1, present: 1 }, revealedAbsent: [], revealedPresent: [] };
  it('waits for the guest wallet, shows prices, and reuses the start request after a network failure', async () => {
    let walletReady!: (response: Response) => void;
    const wallet = new Promise<Response>(resolve => { walletReady = resolve; });
    const starts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return new Response('{}', { status: 401 });
      if (url.endsWith('/games/wallet')) return wallet;
      if (url.endsWith('/collections')) return Response.json([]);
      if (url.endsWith('/library/revision')) return Response.json({});
      if (url.endsWith('/games') && init?.method === 'POST') {
        starts.push(JSON.parse(String(init.body)).startRequestId);
        if (starts.length === 1) throw new Error('Connection lost');
        return Response.json({ ...emptyGame, wordLength: 5, difficulty: 'medium' });
      }
      throw new Error('Unexpected request: ' + url);
    }));
    const user = userEvent.setup(); render(<App />);
    expect(screen.getByRole('button', { name: /start practice/i })).toBeDisabled();
    walletReady(Response.json({ coinBalance: 10, kind: 'guest' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /start practice/i })).toBeEnabled());
    expect(screen.getByRole('link', { name: 'Account' })).toHaveTextContent('10 coins');
    expect(screen.getByText(/Entry: 1 coin/)).toHaveTextContent('Win: 5 coins');
    await user.click(screen.getByRole('button', { name: /start practice/i }));
    expect(await screen.findByText('Connection lost')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /start practice/i }));
    expect(await screen.findByRole('grid', { name: '5-letter puzzle board' })).toBeInTheDocument();
    expect(starts).toHaveLength(2);
    expect(starts[1]).toBe(starts[0]);
    expect(starts[0]).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('starts a nine-letter hard game and presents usable hints with live counts', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return new Response('{}', { status: 401 });
      if (url.endsWith('/word-lists')) return new Response('[]');
      if (url.endsWith('/hints')) return Response.json({ type: 'unused', letters: ['q', 'z', 'x'], hints: { unused: 0, present: 1 } });
      if (init?.method === 'POST') return Response.json(emptyGame);
      throw new Error(`Unexpected request: ${url}`);
    });
    stubFetchWithVocabularyRanges( fetchMock);
    const user = userEvent.setup(); render(<App />);
    expect(screen.getByRole('region', { name: 'Available games' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: '9 letters' }));
    await user.click(screen.getByRole('radio', { name: /Hard/ }));
    await user.click(screen.getByRole('button', { name: /start practice/i }));
    expect(await screen.findByRole('grid', { name: '9-letter puzzle board' })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(5);
    const start = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/games'))!;
    expect(JSON.parse(String(start[1]?.body))).toEqual({ kind: 'word-puzzle', wordLength: 9, difficulty: 'hard', playWithMyWords: false, startRequestId: expect.any(String) });
    await user.click(screen.getByRole('button', { name: /remove letters/i }));
    expect(await screen.findByRole('button', { name: /remove letters.*0 left/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /reveal a letter.*1 left/i })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('Q, Z, X are not in the answer.');
    await user.click(screen.getByRole('button', { name: /^Home$/i }));
    await user.click(screen.getByRole('button', { name: /^Games$/i }));
    expect(screen.getByRole('button', { name: /remove letters.*0 left/i })).toBeDisabled();
  });
  it('restores saved guesses, hint counts, and definitions after a remount', async () => {
    window.localStorage.setItem('lexiplay-last-game', 'saved-game');
    const saved = { ...emptyGame, guesses: [{ guess: 'beautiful', feedback: Array(9).fill('ABSENT'), attemptsRemaining: 4, completed: false, definition: 'Pleasing to look at.' }], hints: { unused: 0, present: 1 } };
    stubFetchWithVocabularyRanges( vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/auth/me') ? new Response('{}', { status: 401 }) : Response.json(saved)));
    render(<App />);
    expect(await screen.findByRole('row', { name: 'beautiful' })).toBeInTheDocument();
    expect(screen.getByText('Pleasing to look at.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove letters.*0 left/i })).toBeDisabled();
    expect(screen.getByText('4 guesses left')).toBeInTheDocument();
  });
  it('renders Statistics and an accessible winning distribution from persisted results', async () => {
    window.history.replaceState({}, '', '/progress');
    stubFetchWithVocabularyRanges( vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/auth/me') ? new Response('{}', { status: 401 }) : Response.json({ total: 8, wins: 4, losses: 4, winRate: 50, streak: 2, timezone: 'America/Toronto', distribution: Array.from({ length: 7 }, (_, i) => ({ attempts: i + 1, wins: i === 2 ? 4 : 0 })), recent: [{ id: 'one', wordLength: 5, difficulty: 'medium', completedAt: '2026-10-11T12:00:00Z', guesses: [{ outcome: 'WON', answer: 'apple' }] }] })));
    render(<App />);
    expect(await screen.findByText('50%')).toBeInTheDocument();
    expect(screen.getByText('2 days')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: '3 guesses: 4 wins' })).toHaveAttribute('value', '4');
    expect(screen.getByRole('meter', { name: '3 guesses: 4 wins' })).toHaveAttribute('max', '4');
    expect(screen.getByRole('meter', { name: '1 guesses: 0 wins' })).toHaveAttribute('max', '4');
    expect(screen.getByText('apple')).toBeInTheDocument();
    expect(screen.getByText('Solved')).toBeInTheDocument();
  });
  it('shows guest guidance for Statistics instead of stale metrics', async () => {
    window.history.replaceState({}, '', '/progress');
    stubFetchWithVocabularyRanges( vi.fn(async () => new Response('{}', { status: 401 })));
    render(<App />);
    expect(await screen.findByText('Sign in to see your saved learning progress.')).toBeInTheDocument();
  });
  it('requests password recovery without disclosing whether an account exists', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/auth/me') ? new Response('{}', { status: 401 }) : Response.json({ message: 'If that email has an account, a reset link will arrive shortly.' }));
    stubFetchWithVocabularyRanges( fetchMock); const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByText('Account'));
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'learner@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('status')).toHaveTextContent('If that email has an account');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/forgot-password', expect.objectContaining({ body: JSON.stringify({ email: 'learner@example.test' }) }));
  });
  it('consumes an email verification link and removes its token from the URL', async () => {
    window.history.replaceState({}, '', '/#action=verify&token=' + 'a'.repeat(43));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/auth/me') ? new Response('{}', { status: 401 }) : Response.json({ message: 'Your email is verified.' }));
    stubFetchWithVocabularyRanges( fetchMock); const user = userEvent.setup(); render(<App />);
    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(window.location.pathname).toBe('/account');
    await user.click(screen.getByRole('button', { name: 'Verify email address' }));
    expect(await screen.findByText('Your email is verified.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/verify-email', expect.objectContaining({ body: JSON.stringify({ token: 'a'.repeat(43) }) }));
  });
});
