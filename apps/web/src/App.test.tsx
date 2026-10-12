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
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ guess: 'word', feedback: ['ABSENT', 'PRESENT', 'ABSENT', 'CORRECT'], attemptsRemaining: 5, completed: false }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await user.click(screen.getByRole('button', { name: /^games$/i }));
    await user.click(screen.getByRole('radio', { name: '4 letters' }));
    await user.click(screen.getByRole('button', { name: /start practice/i }));
    const guessInput = await screen.findByRole('textbox', { name: /four-letter guess/i });
    await user.paste('word');
    expect(guessInput).toHaveValue('');
    await user.type(guessInput, 'word');
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('row', { name: 'word' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({ kind: 'word-puzzle', wordLength: 4, difficulty: 'medium', playWithMyWords: false });
  });

  it('starts a game and submits a guess with server feedback', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'game-1', wordLength: 5, attemptLimit: 6, guesses: [] }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Enter a valid five-letter word from the practice dictionary.' }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ guess: 'crane', definition: 'A large bird.', feedback: ['ABSENT', 'ABSENT', 'CORRECT', 'CORRECT', 'ABSENT'], attemptsRemaining: 5, completed: false }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ guess: 'plant', definition: 'A living organism.', answerDefinition: 'A living organism.', feedback: ['CORRECT', 'CORRECT', 'CORRECT', 'CORRECT', 'CORRECT'], attemptsRemaining: 4, completed: true, outcome: 'WON', answer: 'plant' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'game-2', wordLength: 5, attemptLimit: 6, guesses: [] }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await user.click(screen.getByRole('button', { name: /^games$/i }));
    await user.click(screen.getByRole('button', { name: /start practice/i }));
    const guessInput = await screen.findByRole('textbox', { name: /five-letter guess/i });
    await user.type(guessInput, 'xxxxx');
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/valid five-letter word/i)).toBeInTheDocument();
    expect(screen.getByText(/6 guesses left/i)).toBeInTheDocument();
    await user.keyboard('{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}');
    await user.type(guessInput, 'crane');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(await screen.findByRole('row', { name: 'crane' })).toBeInTheDocument();
    expect(screen.getByText(/5 guesses left/i)).toBeInTheDocument();

    await user.type(guessInput, 'plant');
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/you found it/i)).toBeInTheDocument();
    expect(cachedDictionaryDefinition('crane')).toBe('A large bird.');
    expect(cachedDictionaryDefinition('plant')).toBe('A living organism.');
    await user.click(screen.getByRole('button', { name: /^return$/i }));
    expect(screen.getByRole('button', { name: /start practice/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /start practice/i }));
    expect(await screen.findByRole('textbox', { name: /five-letter guess/i })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it('creates an account through the account page', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        user: { id: 'user-1', email: 'learner@example.test' },
      }), { status: 201 }))
      .mockResolvedValueOnce(Response.json({ wordsAdded: 0, wordsAlreadySaved: 0, gamesTransferred: 0, resumeGameId: null }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
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
    vi.stubGlobal('fetch', fetchMock);
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
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'list-1', name: 'Classroom', description: '', words: [
        { id: 'word-1', term: 'apple', definition: 'A fruit', status: 'UNFAMILIAR' },
        { id: 'word-2', term: 'chair', definition: 'A seat', status: 'UNFAMILIAR' },
      ] }]), { status: 200 }))
      .mockResolvedValueOnce(new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
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
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(String(input).endsWith('/auth/me') ? '{}' : '[]')));
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
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
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
