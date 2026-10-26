import { stubGameApiFetch } from './game-api-test-fixtures';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

describe('saved practice and account updates', () => {
  beforeEach(() => { window.localStorage.clear(); window.history.replaceState({}, '', '/games'); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  const emptyGame = { id: 'saved-game', wordLength: 9, difficulty: 'hard', attemptLimit: 5, guesses: [], hints: { definition: 1 }, clues: {}, hintCoinsSpent: 0, revealedAbsent: [], revealedPresent: [] };
  it('reminds players to click the puzzle after losing keyboard focus and restores typing', async () => {
    localStorage.setItem('lexiplay-last-game', emptyGame.id);
    stubGameApiFetch(vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/auth/me')) return new Response('{}', { status: 401 });
      if (String(input).endsWith(`/games/${emptyGame.id}`)) return Response.json(emptyGame);
      return Response.json([]);
    }));
    const user = userEvent.setup(); render(<App/>);
    const board = await screen.findByRole('grid', { name: '9-letter puzzle board' });
    const input = screen.getByRole('textbox', { name: /Type your nine-letter guess/ });
    await waitFor(() => expect(input).toHaveFocus());
    await user.click(screen.getByRole('searchbox', { name: 'Quick dictionary search' }));
    expect(screen.getByText('Click anywhere in the puzzle to resume typing.')).toBeInTheDocument();
    await user.click(board);
    expect(input).toHaveFocus();
    expect(screen.queryByText('Click anywhere in the puzzle to resume typing.')).not.toBeInTheDocument();
    await user.keyboard('a');
    expect(input).toHaveValue('a');
  });
  it.each([
    { signedIn: false, saved: false, expected: 'cefr-a2' },
    { signedIn: false, saved: true, expected: '' },
    { signedIn: true, saved: false, expected: '' },
  ])('defaults only new guests to A2 (signedIn=$signedIn, saved=$saved)', async ({ signedIn, saved, expected }) => {
    if (saved) localStorage.setItem('lexiplay-practice-preferences', JSON.stringify({ wordLength: 5, difficulty: 'medium', collectionId: '', playWithMyWords: false }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/auth/me')) return signedIn ? Response.json({ id: 'learner', username: 'learner' }) : new Response('{}', { status: 401 });
      if (path.endsWith('/games/wallet')) return Response.json({ coinBalance: 100, kind: signedIn ? 'account' : 'guest' });
      if (path.endsWith('/collections/game-options/all')) return Response.json([{ wordLength: 5, totalWords: 100, collections: [{ id: 'a2', slug: 'cefr-a2', name: 'Oxford A2', wordCount: 12 }] }]);
      if (path.endsWith('/collections')) return Response.json([{ id: 'a2', slug: 'cefr-a2', name: 'Oxford A2', level: 'A2', status: 'available' }]);
      if (path.endsWith('/games') && init?.method === 'POST') return Response.json({ ...emptyGame, wordLength: 5 });
      if (path.endsWith('/saved-terms')) return Response.json({ terms: [] });
      return Response.json([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<App/>);
    await screen.findByRole('option', { name: /Oxford A2/ });
    await waitFor(() => expect(screen.getByLabelText('Collection')).toHaveValue(expected));
    await waitFor(() => expect(screen.getByRole('button', { name: /start practice/i })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /start practice/i }));
    const start = fetchMock.mock.calls.find(([path, init]) => String(path).endsWith('/games') && init?.method === 'POST');
    expect(JSON.parse(String(start?.[1]?.body)).collectionId).toBe(expected || undefined);
  });
  it.each([
    { signedIn: false, status: 'won', reminder: true },
    { signedIn: false, status: 'lost', reminder: true },
    { signedIn: false, status: 'active', reminder: false },
    { signedIn: false, status: 'cancelled', reminder: false },
    { signedIn: true, status: 'won', reminder: false },
  ])('shows a save reminder for signedIn=$signedIn, status=$status', async ({ signedIn, status, reminder }) => {
    localStorage.setItem('lexiplay-last-game', emptyGame.id);
    stubGameApiFetch(vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/auth/me')) return signedIn ? Response.json({ id: 'learner', username: 'learner' }) : new Response('{}', { status: 401 });
      if (path.endsWith(`/games/${emptyGame.id}`)) return Response.json({ ...emptyGame, status, completed: status !== 'active' });
      return Response.json([]);
    }));
    const user = userEvent.setup(); render(<App />);
    await screen.findByText('hard · 9 letters');
    const signIn = screen.queryByRole('link', { name: 'Sign in to save your game history.' });
    if (reminder) {
      expect(signIn).toHaveAttribute('href', '/account');
      await user.click(signIn!);
      expect(await screen.findByLabelText('Username or email')).toBeInTheDocument();
      expect(location.pathname).toBe('/account');
    } else expect(signIn).not.toBeInTheDocument();
  });
  it('keeps the chosen collection for replay, new setup, and reopening the app', async () => {
    const starts: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/auth/me')) return new Response('{}', { status: 401 });
      if (path.endsWith('/games/wallet')) return Response.json({ coinBalance: 10, kind: 'guest' });
      if (path.endsWith('/collections/game-options/all')) return Response.json([{ wordLength: 5, totalWords: 100, collections: [
        { id: 'a2', slug: 'cefr-a2', name: 'CEFR A2', wordCount: 12 },
      ] }]);
      if (path.endsWith('/games') && init?.method === 'POST') {
        starts.push(JSON.parse(String(init.body)));
        return Response.json({ ...emptyGame, id: `game-${starts.length}`, wordLength: 5, difficulty: 'medium', completed: starts.length === 1, status: starts.length === 1 ? 'won' : 'active' });
      }
      return Response.json([]);
    }));
    const user = userEvent.setup();
    const view = render(<App />);
    await screen.findByRole('option', { name: /CEFR A2/ });
    await user.selectOptions(screen.getByLabelText('Collection'), 'cefr-a2');
    await user.click(screen.getByRole('button', { name: /start practice/i }));
    await user.click(await screen.findByRole('button', { name: 'Play again' }));
    await user.click(await screen.findByRole('button', { name: 'Choose a new puzzle' }));
    await screen.findByRole('option', { name: /CEFR A2/ });
    expect(screen.getByLabelText('Collection')).toHaveValue('cefr-a2');
    expect(starts).toHaveLength(2);
    expect(starts[1]).toMatchObject({ collectionId: 'cefr-a2', wordLength: 5, difficulty: 'medium' });
    expect(starts[1]!.startRequestId).not.toBe(starts[0]!.startRequestId);
    view.unmount();
    render(<App />);
    await screen.findByRole('option', { name: /CEFR A2/ });
    expect(screen.getByLabelText('Collection')).toHaveValue('cefr-a2');
  });
  it('focuses quick dictionary search with slash without interrupting text entry', async () => {
    stubGameApiFetch(vi.fn(async () => new Response('{}', { status: 401 })));
    const user = userEvent.setup(); render(<App/>);
    await user.keyboard('/');
    const search = screen.getByRole('searchbox', { name: 'Quick dictionary search' });
    expect(search).toHaveFocus();
    expect(search).toHaveValue('');
    await user.type(search, 'apple/');
    expect(search).toHaveValue('apple/');
    await user.keyboard('{Escape}');
    expect(search).not.toHaveFocus();
  });
  it('removes personal words from the collection selector and ignores legacy preferences', async () => {
    localStorage.setItem('lexiplay-practice-preferences', JSON.stringify({ wordLength: 5, difficulty: 'medium', collectionId: 'my-words', playWithMyWords: true }));
    const starts: Record<string, unknown>[] = [];
    stubGameApiFetch(vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/auth/me')) return Response.json({ id: 'learner', username: 'learner' });
      if (String(input).endsWith('/games') && init?.method === 'POST') {
        starts.push(JSON.parse(String(init.body)));
        return Response.json({ ...emptyGame, wordLength: 5 });
      }
      return Response.json([]);
    }));
    const user = userEvent.setup(); render(<App />);
    expect(screen.queryByRole('region', { name: 'Available games' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Classic Wordle' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /My word list/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Collection')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: /start practice/i }));
    await screen.findByRole('grid', { name: '5-letter puzzle board' });
    expect(starts[0]).toMatchObject({ kind: 'word-puzzle', wordLength: 5, playWithMyWords: false });
    expect(starts[0]).not.toHaveProperty('collectionId');
    await user.click(screen.getByRole('button', { name: 'Choose a new puzzle' }));
    expect(screen.getByLabelText('Collection')).toHaveValue('');
    await user.selectOptions(screen.getByLabelText('Collection'), '');
    await user.click(screen.getByRole('radio', { name: '9 letters' }));
    expect(screen.getByRole('option', { name: 'Common vocabulary' })).toBeInTheDocument();
  });
  it('waits for the guest wallet, shows prices, and reuses the start request after a network failure', async () => {
    let walletReady!: (response: Response) => void;
    const wallet = new Promise<Response>(resolve => { walletReady = resolve; });
    const starts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return new Response('{}', { status: 401 });
      if (url.endsWith('/games/wallet')) return wallet;
      if (url.endsWith('/collections/game-options/all')) return Response.json([{ wordLength: 5, totalWords: 100, collections: [] }]);
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
    expect(screen.getByLabelText('Coin balance: 10')).toHaveTextContent('10');
    expect(screen.getByLabelText('Entry: 1 coin. Win: 5 coins')).toHaveTextContent('+5 on a win');
    await user.click(screen.getByRole('button', { name: /start practice/i }));
    expect(await screen.findByText('Connection lost')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /start practice/i }));
    expect(await screen.findByRole('grid', { name: '5-letter puzzle board' })).toBeInTheDocument();
    expect(starts).toHaveLength(2);
    expect(starts[1]).toBe(starts[0]);
    expect(starts[0]).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('starts a hard game with only a definition hint beside the grid', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return new Response('{}', { status: 401 });
      if (url.endsWith('/word-lists')) return new Response('[]');
      if (url.endsWith('/hints')) return Response.json({ type: 'definition', text: 'Having great beauty.', cost: 1, hints: { definition: 0 } });
      if (init?.method === 'POST') return Response.json(emptyGame);
      throw new Error(`Unexpected request: ${url}`);
    });
    stubGameApiFetch( fetchMock);
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('radio', { name: '9 letters' }));
    await user.click(screen.getByRole('radio', { name: /Hard/ }));
    await user.click(screen.getByRole('button', { name: /start practice/i }));
    expect(await screen.findByRole('grid', { name: '9-letter puzzle board' })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(5);
    const start = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/games'))!;
    expect(JSON.parse(String(start[1]?.body))).toEqual({ kind: 'word-puzzle', wordLength: 9, difficulty: 'hard', playWithMyWords: false, startRequestId: expect.any(String) });
    await user.click(screen.getByRole('button', { name: /definition hint.*1 coin/i }));
    expect(await screen.findByRole('button', { name: /definition hint.*revealed/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /part of speech/i })).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Definition hint' })).toHaveTextContent('Having great beauty.');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/games/saved-game/hints', expect.objectContaining({ body: JSON.stringify({ type: 'definition' }) }));
    await user.click(screen.getByRole('link', { name: 'LexiPlay home' }));
    await user.click(screen.getByRole('button', { name: /^Games$/i }));
    expect(screen.getByRole('button', { name: /definition hint.*revealed/i })).toBeDisabled();
  });
  it('refreshes the coin badge after a purchase and leaves failed hints available', async () => {
    localStorage.setItem('lexiplay-last-game', 'saved-game');
    let balance = 9, hintAttempts = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/auth/me')) return new Response('{}', { status: 401 });
      if (path.endsWith('/games/wallet')) return Response.json({ coinBalance: balance, kind: 'guest' });
      if (path.endsWith('/collections/game-options/all')) return Response.json([{ wordLength: 5, totalWords: 100, collections: [] }]);
      if (path.endsWith('/games/saved-game')) return Response.json(emptyGame);
      if (path.endsWith('/hints')) {
        if (++hintAttempts === 1) return Response.json({ message: 'Definition lookup is unavailable. No coins were charged.' }, { status: 503 });
        balance--;
        return Response.json({ type: 'definition', text: 'Pleasing to look at. Often admired by others.; Another meaning.', cost: 1, hints: { definition: 0 } });
      }
      return Response.json([]);
    }));
    const user = userEvent.setup(); render(<App/>);
    expect(await screen.findByLabelText('Coin balance: 9')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /definition hint.*1 coin/i }));
    expect(await screen.findByText(/No coins were charged/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /definition hint.*1 coin/i })).toBeEnabled();
    expect(screen.getByLabelText('Coin balance: 9')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /definition hint.*1 coin/i }));
    expect(await screen.findByLabelText('Coin balance: 8')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Definition hint' })).toHaveTextContent('Pleasing to look at.');
    expect(screen.getByRole('complementary', { name: 'Definition hint' })).not.toHaveTextContent('Often admired');
    expect(screen.getByRole('complementary', { name: 'Definition hint' })).not.toHaveTextContent('Another meaning');
    expect(screen.getByRole('button', { name: /definition hint.*revealed/i })).toBeDisabled();
  });
  it('restores saved guesses, hint counts, and definitions after a remount', async () => {
    window.localStorage.setItem('lexiplay-last-game', 'saved-game');
    const saved = { ...emptyGame, guesses: [{ guess: 'beautiful', feedback: Array(9).fill('ABSENT'), attemptsRemaining: 4, completed: false, definition: 'Pleasing to look at.' }], hints: { definition: 0 }, clues: { definition: 'Having great beauty.; A second meaning. More explanation.' }, hintCoinsSpent: 1 };
    stubGameApiFetch( vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/auth/me') ? new Response('{}', { status: 401 }) : Response.json(saved)));
    render(<App />);
    expect(await screen.findByRole('row', { name: 'beautiful' })).toBeInTheDocument();
    expect(screen.getByText('Pleasing to look at.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /definition hint.*revealed/i })).toBeDisabled();
    expect(screen.getByRole('complementary', { name: 'Definition hint' })).toHaveTextContent('Having great beauty.');
    expect(screen.getByRole('complementary', { name: 'Definition hint' })).not.toHaveTextContent('A second meaning');
    expect(screen.getByText('4 guesses left')).toBeInTheDocument();
  });
  it('restores a completed summary without rebuilding discarded guesses', async () => {
    localStorage.setItem('lexiplay-last-game','saved-game');
    stubGameApiFetch(vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/auth/me')
      ? new Response('{}',{status:401}) : Response.json({...emptyGame,status:'won',completed:true,answer:'beautiful',answerDefinition:'Pleasing to look at.',attemptCount:3,coinChange:5})));
    render(<App />);
    expect(await screen.findByText('beautiful')).toBeInTheDocument();
    expect(screen.getByText('Pleasing to look at.')).toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(screen.queryByRole('group',{name:'On-screen keyboard'})).not.toBeInTheDocument();
  });
  it('keeps an unfinished puzzle available when its refund request fails', async () => {
    localStorage.setItem('lexiplay-last-game','saved-game');
    let fail=true;
    const fetchMock=vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/auth/me')) return new Response('{}',{status:401});
      if (String(input).endsWith('/abandon')) return fail ? new Response('{"message":"Try refund again"}',{status:503}) : Response.json({success:true});
      return Response.json(emptyGame);
    });
    stubGameApiFetch(fetchMock);
    const user=userEvent.setup();render(<App />);
    await user.click(await screen.findByRole('button',{name:'Choose a new puzzle'}));
    expect(await screen.findByText('Try refund again')).toBeInTheDocument();
    expect(localStorage.getItem('lexiplay-last-game')).toBe('saved-game');
    fail=false;
    await user.click(screen.getByRole('button',{name:'Choose a new puzzle'}));
    expect(await screen.findByRole('button',{name:/start practice/i})).toBeInTheDocument();
    expect(localStorage.getItem('lexiplay-last-game')).toBeNull();
  });
  it('renders Statistics and recent practice without the winning guesses panel', async () => {
    window.history.replaceState({}, '', '/progress');
    stubGameApiFetch( vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/auth/me') ? new Response('{}', { status: 401 }) : Response.json({ total: 8, wins: 4, losses: 4, winRate: 50, streak: 2, timezone: 'America/Toronto', page: 1, pageSize: 10, totalPages: 1, distribution: Array.from({ length: 7 }, (_, i) => ({ attempts: i + 1, wins: i === 2 ? 4 : 0 })), recent: [{ id: 'one', wordLength: 5, difficulty: 'medium', completedAt: '2026-10-11T12:00:00Z', answer:'apple',status:'won',attemptCount:1,coinChange:4 }] })));
    render(<App />);
    expect(await screen.findByText('50%')).toBeInTheDocument();
    expect(screen.getByText('2 days')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Winning guesses' })).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.getByText('apple')).toBeInTheDocument();
    expect(screen.getByText('Solved')).toBeInTheDocument();
  });
  it('shows guest guidance for Statistics instead of stale metrics', async () => {
    window.history.replaceState({}, '', '/progress');
    stubGameApiFetch( vi.fn(async () => new Response('{}', { status: 401 })));
    render(<App />);
    expect(await screen.findByText('Sign in to see your saved learning progress.')).toBeInTheDocument();
  });
  it('requests password recovery without disclosing whether an account exists', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/auth/me') ? new Response('{}', { status: 401 }) : Response.json({ message: 'If that email has an account, a reset link will arrive shortly.' }));
    stubGameApiFetch( fetchMock); const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByText('Account'));
    await user.click(await screen.findByRole('button', { name: 'Forgot password?' }));
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'learner@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('status')).toHaveTextContent('If that email has an account');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/forgot-password', expect.objectContaining({ body: JSON.stringify({ email: 'learner@example.test' }) }));
  });
  it('consumes an email verification link and removes its token from the URL', async () => {
    window.history.replaceState({}, '', '/#action=verify&token=' + 'a'.repeat(43));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/auth/me') ? new Response('{}', { status: 401 }) : Response.json({ message: 'Your email is verified.' }));
    stubGameApiFetch( fetchMock); const user = userEvent.setup(); render(<App />);
    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(window.location.pathname).toBe('/account');
    await user.click(screen.getByRole('button', { name: 'Verify email address' }));
    expect(await screen.findByText('Your email is verified.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/verify-email', expect.objectContaining({ body: JSON.stringify({ token: 'a'.repeat(43) }) }));
  });
});
