import { stubGameApiFetch } from './game-api-test-fixtures';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { cachedDictionaryDefinition, clearDictionaryCache } from './dictionary-cache';

describe('practice puzzle', () => {
  beforeEach(() => { window.localStorage.clear(); window.history.replaceState({}, '', '/'); });
  afterEach(() => {
    cleanup();
    clearDictionaryCache();
    vi.unstubAllGlobals();
  });

  it('lets players choose a four-letter game and requires one character per keystroke', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'game-4', wordLength: 4, attemptLimit: 6, guesses: [] }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ guess: 'word', feedback: ['ABSENT', 'PRESENT', 'ABSENT', 'CORRECT'], attemptsRemaining: 5, completed: false }), { status: 201 }));
    stubGameApiFetch( fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await user.click(screen.getByRole('button', { name: /^games$/i }));
    const rules = screen.getByText('How to play').closest('details')!;
    expect(rules.open).toBe(false);
    await user.click(within(rules).getByText('How to play'));
    expect(rules.open).toBe(true);
    await user.click(screen.getByRole('radio', { name: '4 letters' }));
    await user.click(screen.getByRole('button', { name: /start practice/i }));
    const guessInput = await screen.findByRole('textbox', { name: /four-letter guess/i });
    await user.paste('word');
    expect(guessInput).toHaveValue('');
    await user.type(guessInput, 'word');

    expect(await screen.findByRole('row', { name: 'word' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({ kind: 'word-puzzle', wordLength: 4, difficulty: 'medium', playWithMyWords: false, startRequestId: expect.any(String) });
  });

  it('starts a game and submits a guess with server feedback', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'game-1', wordLength: 5, attemptLimit: 6, guesses: [] }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'INVALID_GUESS', message: 'Enter a valid five-letter word from the practice dictionary.' }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ guess: 'crane', definition: 'A large bird.', feedback: ['ABSENT', 'ABSENT', 'CORRECT', 'CORRECT', 'ABSENT'], attemptsRemaining: 5, completed: false }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ guess: 'plant', definition: 'A living organism.', answerDefinition: 'A living organism.', feedback: ['CORRECT', 'CORRECT', 'CORRECT', 'CORRECT', 'CORRECT'], attemptsRemaining: 4, completed: true, outcome: 'WON', answer: 'plant' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'game-2', wordLength: 5, attemptLimit: 6, guesses: [] }), { status: 201 }))
      ;
    stubGameApiFetch( fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await user.click(screen.getByRole('button', { name: /^games$/i }));
    await user.click(screen.getByRole('button', { name: /start practice/i }));
    const guessInput = await screen.findByRole('textbox', { name: /five-letter guess/i });
    await user.type(guessInput, 'xxxxx');
    expect(await screen.findByText(/XXXXX is not in the dictionary/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose a new puzzle' })).toBeEnabled();
    expect(screen.getByRole('row', { name: 'Guess 1' })).toHaveClass('invalid-guess');
    expect(guessInput).toHaveValue('xxxxx');
    expect(screen.getByText(/6 guesses left/i)).toBeInTheDocument();
    await user.keyboard('{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}');
    await user.type(guessInput, 'crane');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(await screen.findByRole('row', { name: 'crane' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose a new puzzle' })).toBeDisabled();
    expect(screen.getByText(/5 guesses left/i)).toBeInTheDocument();

    await user.type(guessInput, 'plant');
    expect(await screen.findByText(/you found it/i)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Vocabulary puzzle' }).querySelector('.puzzle-celebration')).toHaveAttribute('aria-hidden', 'true');
    await user.click(screen.getByRole('link', { name: 'LexiPlay home' }));
    await user.click(screen.getByRole('button', { name: 'Games' }));
    expect(screen.getByRole('region', { name: 'Vocabulary puzzle' }).querySelector('.puzzle-celebration')).toBeNull();
    expect(screen.getByRole('region', { name: 'Vocabulary puzzle' }).querySelector('.puzzle-won')).toBeNull();
    expect(cachedDictionaryDefinition('crane')).toBe('A large bird.');
    expect(cachedDictionaryDefinition('plant')).toBe('A living organism.');
    await user.click(screen.getByRole('button', { name: 'Play again' }));
    expect(await screen.findByRole('textbox', { name: /five-letter guess/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Vocabulary puzzle' }).querySelector('.puzzle-celebration')).toBeNull();
    expect(screen.queryByRole('button', { name: /start practice/i })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('checks a word on its final on-screen letter and prevents duplicate requests while checking', async () => {
    let resolveGuess!: (response: Response) => void;
    const pendingGuess = new Promise<Response>(resolve => { resolveGuess = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return new Response('{}', { status: 401 });
      if (url.endsWith('/word-lists')) return Response.json([]);
      if (url.endsWith('/guesses')) return pendingGuess;
      return Response.json({ id: 'game-1', wordLength: 5, attemptLimit: 6, guesses: [] });
    });
    stubGameApiFetch( fetchMock);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Games' }));
    await user.click(screen.getByRole('button', { name: /start practice/i }));
    const input = await screen.findByRole('textbox', { name: /five-letter guess/i });
    expect(input).toHaveAttribute('inputmode', 'none');
    expect(input).toHaveAttribute('readonly');
    for (const letter of ['C', 'R', 'A', 'N']) await user.click(screen.getByRole('button', { name: letter }));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/guesses'))).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'E' }));
    expect(screen.getByRole('region', { name: 'Vocabulary puzzle' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Checking…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'E' })).toBeDisabled();
    expect(screen.getByRole('row', { name: 'Guess 1' })).toHaveAttribute('aria-busy', 'true');
    await user.keyboard('{Enter}{Enter}');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/guesses'))).toHaveLength(1);
    await act(async () => resolveGuess(Response.json({ guess: 'crane', feedback: Array(5).fill('ABSENT'), attemptsRemaining: 5, completed: false })));
    expect(await screen.findByRole('row', { name: 'crane' })).toBeInTheDocument();
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    await user.keyboard('pl');
    expect(input).toHaveValue('pl');
    expect(screen.getByRole('row', { name: 'Guess 2' })).not.toHaveAttribute('aria-busy');
    expect(screen.queryByText('Find the word')).not.toBeInTheDocument();
  });

  it('resumes typing after navigation and leaves modified keyboard shortcuts alone', async () => {
    stubGameApiFetch(vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/auth/me')) return new Response('{}', { status: 401 });
      return Response.json({ id: 'game-focus', wordLength: 5, attemptLimit: 6, guesses: [] });
    }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Games' }));
    await user.click(screen.getByRole('button', { name: /start practice/i }));
    const input = await screen.findByRole('textbox', { name: /five-letter guess/i });
    expect(fireEvent.keyDown(input, { key: 'a', ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'k', metaKey: true })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'b', altKey: true })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'a', isComposing: true })).toBe(true);
    expect(input).toHaveValue('');
    await user.keyboard('cr');
    await user.click(screen.getByRole('link', { name: 'LexiPlay home' }));
    await user.click(screen.getByRole('button', { name: 'Games' }));
    const resumed = screen.getByRole('textbox', { name: /five-letter guess/i });
    expect(resumed).toHaveFocus();
    await user.keyboard('a');
    expect(resumed).toHaveValue('cra');
  });

  it('keeps a network-failed guess for an explicit retry without resubmitting in a loop', async () => {
    let submissions = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return new Response('{}', { status: 401 });
      if (url.endsWith('/word-lists')) return Response.json([]);
      if (url.endsWith('/guesses')) {
        if (++submissions === 1) throw new Error('Connection lost. Try again.');
        return Response.json({ guess: 'crane', feedback: Array(5).fill('ABSENT'), attemptsRemaining: 5, completed: false });
      }
      return Response.json({ id: 'game-1', wordLength: 5, attemptLimit: 6, guesses: [] });
    });
    stubGameApiFetch( fetchMock);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Games' }));
    await user.click(screen.getByRole('button', { name: /start practice/i }));
    const input = await screen.findByRole('textbox', { name: /five-letter guess/i });
    await user.type(input, 'crane');
    expect(await screen.findByRole('status')).toHaveTextContent('Connection lost. Try again.');
    expect(input).toHaveValue('crane');
    expect(screen.getByRole('row', { name: 'Guess 1' })).not.toHaveClass('invalid-guess');
    expect(submissions).toBe(1);
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('row', { name: 'crane' })).toBeInTheDocument();
    expect(submissions).toBe(2);
  });

  it('shows rules for the selected length and difficulty before starting', async () => {
    stubGameApiFetch( vi.fn(async () => new Response('{}', { status: 401 })));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Games' }));
    expect(screen.getByText('How to play').closest('details')).not.toHaveAttribute('open');
    expect(screen.getByRole('img', { name: 'Word puzzle example' })).toBeInTheDocument();
    await user.click(screen.getByText('How to play'));
    expect(screen.getByText(/hidden 5-letter word in 6 guesses/i)).toBeVisible();
    await user.click(screen.getByRole('radio', { name: '9 letters' }));
    await user.click(screen.getByRole('radio', { name: /Hard/ }));
    expect(screen.getByText(/hidden 9-letter word in 5 guesses/i)).toBeInTheDocument();
    expect(screen.getByText('Correct spot')).toBeInTheDocument();
    expect(screen.getByText('Wrong spot')).toBeInTheDocument();
    expect(screen.getByText('Not in word')).toBeInTheDocument();
  });

  it('does not restore an old puzzle when an automatic guess finishes after an account change', async () => {
    let resolveGuess!: (response: Response) => void;
    const pendingGuess = new Promise<Response>(resolve => { resolveGuess = resolve; });
    stubGameApiFetch( vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return new Response('{}', { status: 401 });
      if (url.endsWith('/word-lists')) return Response.json([]);
      if (url.endsWith('/guesses')) return pendingGuess;
      return Response.json({ id: 'guest-game', wordLength: 5, attemptLimit: 6, guesses: [] });
    }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Games' }));
    await user.click(screen.getByRole('button', { name: /start practice/i }));
    await user.type(await screen.findByRole('textbox', { name: /five-letter guess/i }), 'crane');
    act(() => window.dispatchEvent(new CustomEvent('lexiplay:account-change')));
    await act(async () => resolveGuess(Response.json({ guess: 'crane', feedback: Array(5).fill('ABSENT'), attemptsRemaining: 5, completed: false })));
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(screen.getByText('How to play').closest('details')).not.toHaveAttribute('open');
    expect(screen.getByRole('button', { name: /start practice/i })).toBeEnabled();
  });

  it('creates an account through the account page', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/auth/me')) return new Response('{}', { status: 401 });
      if (path.endsWith('/auth/register')) return Response.json({ user: { id: 'user-1', email: 'learner@example.test' } }, { status: 201 });
      if (path.endsWith('/auth/logout')) return new Response(null, { status: 204 });
      if (path.endsWith('/progress/claim')) return Response.json({ wordsAdded: 0, wordsAlreadySaved: 0, gamesTransferred: 0, resumeGameId: null });
      if (path.endsWith('/word-lists/saved-terms')) return Response.json({ terms: [] });
      return Response.json([]);
    });
    stubGameApiFetch( fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await user.click(screen.getByText('Account'));
    await user.click(await screen.findByRole('tab', { name: /create account/i }));
    await user.type(screen.getByRole('textbox', { name: /^username$/i }), 'learner');
    await user.type(screen.getByLabelText(/^password$/i), 'wordpractice123');
    await user.click(screen.getByRole('button', { name: /^create account$/i }));

    expect(await screen.findByText(/signed in as learner@example\.test/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/auth/register', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ username: 'learner', password: 'wordpractice123' }),
    }));
    await user.click(screen.getByRole('button', { name: /sign out/i }));
    expect(await screen.findByText(/you’re signed out/i)).toBeInTheDocument();
  });

  it('shows account creation errors and keeps the user signed out', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'An account with this email already exists.' }), { status: 409 }));
    stubGameApiFetch( fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await user.click(screen.getByText('Account'));
    await user.click(await screen.findByRole('tab', { name: /create account/i }));
    await user.type(screen.getByRole('textbox', { name: /^username$/i }), 'learner');
    await user.type(screen.getByLabelText(/^password$/i), 'wordpractice123');
    await user.click(screen.getByRole('button', { name: /^create account$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('An account with this email already exists.');
    expect(screen.queryByText(/signed in as/i)).toBeNull();
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/auth/register', expect.objectContaining({ method: 'POST' }));
  });

  it('navigates between the learning library and Wordle practice', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/auth/me')) return new Response('{}', { status: 401 });
      if (path.includes('/word-lists/dictionary?q=')) return Response.json([{ term: path.includes('q=pear') ? 'pear' : 'apple', definition: 'A fruit', partOfSpeech: ['noun'] }]);
      if (path.endsWith('/word-lists')) return Response.json([{ id: 'list-1', name: 'Classroom', words: [
        { id: 'word-1', term: 'apple', definition: 'A fruit', status: 'UNFAMILIAR' },
        { id: 'word-2', term: 'chair', definition: 'A seat', status: 'UNFAMILIAR' },
      ] }]);
      return Response.json([]);
    });
    stubGameApiFetch(fetchMock);
    const user = userEvent.setup();

    render(<App />);
    expect(screen.getByRole('navigation', { name: /main navigation/i })).toBeInTheDocument();
    const navigation = screen.getByRole('navigation', { name: /main navigation/i });
    expect(within(navigation).queryByRole('button', { name: /word sets/i })).toBeNull();
    expect(within(navigation).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['Games', 'Words', 'Dictionary', 'Stats', 'Settings']);
    await user.type(screen.getByRole('searchbox', { name: /quick dictionary search/i }), 'apple');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/dictionary');
    expect(await screen.findByRole('searchbox', { name: 'Search the dictionary' })).toHaveValue('apple');
    expect(await screen.findByText('apple')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pronounce apple' })).toBeInTheDocument();
    const quickSearch = screen.getByRole('searchbox', { name: /quick dictionary search/i });
    await user.clear(quickSearch);
    await user.type(quickSearch, 'pear');
    await user.click(screen.getByRole('button', { name: 'Search dictionary' }));
    expect(await screen.findByText('pear')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search the dictionary' })).toHaveValue('pear');
    expect(screen.queryByText('apple')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Words' }));
    expect(window.location.pathname).toBe('/library');
    expect(await screen.findByRole('tab', { name: 'Explore Vocabulary' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('searchbox', { name: 'Search the dictionary' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^games$/i }));
    expect(screen.getByRole('button', { name: /start practice/i })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/games');
    expect(screen.getByRole('searchbox', { name: /quick dictionary search/i })).toHaveValue('');
  });

  it('groups community under Stats and feedback and account under Settings', async () => {
    stubGameApiFetch(vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/feedback') ? Response.json({ id: 'feedback-1' }) : new Response('{}', { status: 401 })));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Stats' }));
    expect(await screen.findByText('Sign in to see your saved learning progress.')).toBeInTheDocument();
    const statsNavigation = screen.getByRole('navigation', { name: 'Stats sections' });
    expect(within(statsNavigation).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(within(statsNavigation).queryByRole('link', { name: 'Feedback' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const settingsNavigation = screen.getByRole('navigation', { name: 'Settings sections' });
    await user.click(within(settingsNavigation).getByRole('link', { name: 'Account' }));
    expect(window.location.pathname).toBe('/account');
    expect(await screen.findByRole('textbox', { name: 'Username or email' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    await user.click(within(settingsNavigation).getByRole('link', { name: 'Feedback' }));
    expect(window.location.pathname).toBe('/feedback');
    expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    await user.type(await screen.findByRole('textbox', { name: 'Your message' }), 'More word puzzles, please.');
    await user.click(screen.getByRole('button', { name: 'Send feedback' }));
    expect(await screen.findByText('Your feedback has been received.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stats' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Stats sections' })).getByRole('link', { name: 'Community' }));
    expect(window.location.pathname).toBe('/community');
    expect(screen.getByRole('button', { name: 'Stats' })).toHaveClass('active');
    await user.click(await screen.findByRole('button', { name: 'Explore vocabulary' }));
    expect(window.location.pathname).toBe('/library');
    expect(screen.getByRole('button', { name: 'Words' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('navigation', { name: 'Stats sections' })).not.toBeInTheDocument();
    act(() => { history.pushState({}, '', '/feedback'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('link', { name: 'Feedback' })).toHaveAttribute('aria-current', 'page');
  });

  it('clears search on page navigation and keeps attribution on the footer licenses page', async () => {
    stubGameApiFetch( vi.fn(async (input: RequestInfo | URL) => new Response(String(input).endsWith('/auth/me') ? '{}' : '[]')));
    const user = userEvent.setup();
    render(<App />);
    const search = screen.getByRole('searchbox', { name: /quick dictionary search/i });
    await user.type(search, 'because');
    await user.click(screen.getByRole('link', { name: 'Licenses' }));
    expect(search).toHaveValue('');
    expect(window.location.pathname).toBe('/licenses');
    expect(screen.getByRole('region', { name: 'Licenses and attribution' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Simple English Wiktionary' })).toBeInTheDocument();
    await user.type(search, 'apple');
    act(() => { window.history.pushState({}, '', '/library'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(search).toHaveValue('');
    expect(screen.queryByText(/definitions are adapted/i)).not.toBeInTheDocument();
  });

  it('selects word lengths without offering a personal collection', async () => {
    stubGameApiFetch( vi.fn(async input => String(input).endsWith('/auth/me') ? Response.json({ id: 'learner', username: 'learner' }) : Response.json([])));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /^games$/i }));
    expect(screen.getByRole('radio', { name: '5 letters' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: '8 letters' }));
    expect(screen.getByRole('radio', { name: '8 letters' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '5 letters' })).not.toBeChecked();
    const collection = screen.getByLabelText('Collection');
    expect(screen.queryByRole('option', { name: 'My word list' })).not.toBeInTheDocument();
    expect(collection).toHaveValue('');
    expect(screen.queryByRole('switch', { name: 'Play with my words' })).not.toBeInTheDocument();
  });
});
