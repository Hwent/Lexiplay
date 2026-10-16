import { stubFetchWithVocabularyRanges } from './vocabulary-range-test-fixtures';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
    stubFetchWithVocabularyRanges( fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await user.click(screen.getByRole('button', { name: /^games$/i }));
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
    stubFetchWithVocabularyRanges( fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await user.click(screen.getByRole('button', { name: /^games$/i }));
    await user.click(screen.getByRole('button', { name: /start practice/i }));
    const guessInput = await screen.findByRole('textbox', { name: /five-letter guess/i });
    await user.type(guessInput, 'xxxxx');
    expect(await screen.findByText(/XXXXX is not in the dictionary/i)).toBeInTheDocument();
    expect(screen.getByRole('row', { name: 'Guess 1' })).toHaveClass('invalid-guess');
    expect(guessInput).toHaveValue('xxxxx');
    expect(screen.getByText(/6 guesses left/i)).toBeInTheDocument();
    await user.keyboard('{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}');
    await user.type(guessInput, 'crane');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(await screen.findByRole('row', { name: 'crane' })).toBeInTheDocument();
    expect(screen.getByText(/5 guesses left/i)).toBeInTheDocument();

    await user.type(guessInput, 'plant');
    expect(await screen.findByText(/you found it/i)).toBeInTheDocument();
    expect(cachedDictionaryDefinition('crane')).toBe('A large bird.');
    expect(cachedDictionaryDefinition('plant')).toBe('A living organism.');
    await user.click(screen.getByRole('button', { name: /^return$/i }));
    expect(screen.getByRole('button', { name: /start practice/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /start practice/i }));
    expect(await screen.findByRole('textbox', { name: /five-letter guess/i })).toBeInTheDocument();
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
    stubFetchWithVocabularyRanges( fetchMock);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Games' }));
    await user.click(screen.getByRole('button', { name: /start practice/i }));
    const input = await screen.findByRole('textbox', { name: /five-letter guess/i });
    for (const letter of ['C', 'R', 'A', 'N']) await user.click(screen.getByRole('button', { name: letter }));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/guesses'))).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'E' }));
    expect(screen.getByRole('status')).toHaveTextContent('Checking…');
    expect(screen.getByRole('button', { name: 'E' })).toBeDisabled();
    await user.keyboard('{Enter}{Enter}');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/guesses'))).toHaveLength(1);
    await act(async () => resolveGuess(Response.json({ guess: 'crane', feedback: Array(5).fill('ABSENT'), attemptsRemaining: 5, completed: false })));
    expect(await screen.findByRole('row', { name: 'crane' })).toBeInTheDocument();
    expect(input).toHaveValue('');
    expect(screen.queryByText('Find the word')).not.toBeInTheDocument();
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
    stubFetchWithVocabularyRanges( fetchMock);
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
    stubFetchWithVocabularyRanges( vi.fn(async () => new Response('{}', { status: 401 })));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Games' }));
    expect(screen.getByRole('heading', { name: 'Wordle rules' })).toBeInTheDocument();
    expect(screen.getByText(/hidden 5-letter word in 6 guesses/i)).toBeInTheDocument();
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
    stubFetchWithVocabularyRanges( vi.fn(async (input: RequestInfo | URL) => {
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
    expect(screen.getByRole('heading', { name: 'Wordle rules' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start practice/i })).toBeEnabled();
  });

  it('creates an account through the account page', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        user: { id: 'user-1', email: 'learner@example.test' },
      }), { status: 201 }))
      .mockResolvedValueOnce(Response.json({ wordsAdded: 0, wordsAlreadySaved: 0, gamesTransferred: 0, resumeGameId: null }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    stubFetchWithVocabularyRanges( fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await user.click(screen.getByText('Account'));
    await user.click(screen.getByRole('tab', { name: /create account/i }));
    await user.type(screen.getByRole('textbox', { name: /^username$/i }), 'learner');
    await user.type(screen.getByRole('textbox', { name: /email/i }), 'learner@example.test');
    await user.type(screen.getByLabelText(/^password$/i), 'wordpractice123');
    await user.click(screen.getByRole('button', { name: /^create account$/i }));

    expect(await screen.findByText(/signed in as learner@example\.test/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/auth/register', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'learner@example.test', username: 'learner', password: 'wordpractice123', sendVerification: false }),
    }));
    await user.click(screen.getByRole('button', { name: /sign out/i }));
    expect(await screen.findByText(/you’re signed out/i)).toBeInTheDocument();
  });

  it('shows account creation errors and keeps the user signed out', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'An account with this email already exists.' }), { status: 409 }));
    stubFetchWithVocabularyRanges( fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await user.click(screen.getByText('Account'));
    await user.click(screen.getByRole('tab', { name: /create account/i }));
    await user.type(screen.getByRole('textbox', { name: /^username$/i }), 'learner');
    await user.type(screen.getByRole('textbox', { name: /email/i }), 'learner@example.test');
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
      if (path.includes('/word-lists/dictionary?q=')) return Response.json([{ term: 'apple', definition: 'A fruit', partOfSpeech: ['noun'] }]);
      if (path.endsWith('/word-lists')) return Response.json([{ id: 'list-1', name: 'Classroom', words: [
        { id: 'word-1', term: 'apple', definition: 'A fruit', status: 'UNFAMILIAR' },
        { id: 'word-2', term: 'chair', definition: 'A seat', status: 'UNFAMILIAR' },
      ] }]);
      return Response.json([]);
    });
    stubFetchWithVocabularyRanges(fetchMock);
    const user = userEvent.setup();

    render(<App />);
    expect(screen.getByRole('navigation', { name: /main navigation/i })).toBeInTheDocument();
    const navigation = screen.getByRole('navigation', { name: /main navigation/i });
    expect(within(navigation).queryByRole('button', { name: /word sets/i })).toBeNull();
    expect(within(navigation).getByRole('button', { name: /^word list$/i })).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: /search your words/i }), 'apple');
    await user.keyboard('{Enter}');
    expect(await screen.findByText('apple')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/library');
    expect(screen.queryByText('chair')).toBeNull();
    await user.click(screen.getByRole('button', { name: /^games$/i }));
    expect(screen.getByRole('button', { name: /start practice/i })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/games');
    expect(screen.getByRole('searchbox', { name: /search your words/i })).toHaveValue('');
  });

  it('clears search on page navigation and keeps attribution on the footer licenses page', async () => {
    stubFetchWithVocabularyRanges( vi.fn(async (input: RequestInfo | URL) => new Response(String(input).endsWith('/auth/me') ? '{}' : '[]')));
    const user = userEvent.setup();
    render(<App />);
    const search = screen.getByRole('searchbox', { name: /search your words/i });
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

  it('selects word lengths and the personal pool with the redesigned controls', async () => {
    stubFetchWithVocabularyRanges( vi.fn(async () => new Response('{}', { status: 401 })));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /^games$/i }));
    expect(screen.getByRole('radio', { name: '5 letters' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: '8 letters' }));
    expect(screen.getByRole('radio', { name: '8 letters' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '5 letters' })).not.toBeChecked();
    const personalPool = screen.getByRole('switch', { name: 'Play with my words' });
    await user.click(personalPool);
    expect(personalPool).toBeChecked();
    expect(screen.getByText('Answers from your saved vocabulary.')).toBeInTheDocument();
  });
});
