import { stubFetchWithVocabularyRanges } from './vocabulary-range-test-fixtures';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { LAST_GAME_KEY, LOCAL_WORDS_KEY, TRANSFER_KEY } from './services/guest-progress';

const account = { id: '00000000-0000-4000-8000-000000000001', username: 'learner', email: null, emailVerified: false };
const gameId = '00000000-0000-4000-8000-000000000002';
const word = { id: 'local-1', term: 'chair', definition: 'A seat.', status: 'KNOWN' };
const game = { id: gameId, wordLength: 5, difficulty: 'medium', attemptLimit: 6, guesses: [{ guess: 'paper', feedback: ['PRESENT', 'ABSENT', 'PRESENT', 'ABSENT', 'ABSENT'], attemptsRemaining: 5, completed: false, definition: 'Writing material.' }], hints: { partOfSpeech: 1, definition: 1 }, revealedAbsent: [], revealedPresent: [] };
describe('guest progress on authentication', () => {
  beforeEach(() => {
    window.localStorage.clear(); window.history.replaceState({}, '', '/account');
    window.localStorage.setItem(LOCAL_WORDS_KEY, JSON.stringify([{ id: 'local-list', name: 'My words', words: [word] }]));
    window.localStorage.setItem(LAST_GAME_KEY, gameId);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it.each(['Sign in', 'Create account'])('saves local words and resumes the guest puzzle after %s', async mode => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/auth/me')) return new Response('{}', { status: 401 });
      if (path.endsWith('/auth/login') || path.endsWith('/auth/register')) return Response.json({ user: account });
      if (path.endsWith('/progress/claim')) return Response.json({ wordsAdded: 1, wordsAlreadySaved: 0, gamesTransferred: 2, resumeGameId: gameId });
      if (path.endsWith(`/games/${gameId}`)) return Response.json(game);
      if (path.endsWith('/collections')) return Response.json([]);
      if (path.endsWith('/word-lists/mine')) return Response.json([{ id:'account-list',name:'My words',isDefault:true,preferredLanguage:'en',wordCount:1 }]);
      if (path.includes('/word-lists/account-list/entries?')) return Response.json({ list:{id:'account-list',name:'My words',preferredLanguage:'en'},page:1,pageSize:25,total:1,words:[{id:'account-word',lemma:'chair',partOfSpeech:'noun',stage:'Core',definition:'A seat.',customDefinition:'A seat.',customLanguage:'en',language:'en',definitionSource:'custom',familiarity:5,nextReviewAt:null}] });
      if (path.endsWith('/word-lists')) return Response.json([{ id: 'account-list', name: 'My words', words: [{ ...word, id: 'account-word' }] }]);
      throw new Error(`Unexpected request: ${path}`);
    }); stubFetchWithVocabularyRanges( fetchMock); const user = userEvent.setup(); render(<App />);
    if (mode === 'Create account') { await user.click(await screen.findByRole('tab', { name: mode })); await user.type(screen.getByLabelText('Username'), 'learner'); }
    else await user.type(await screen.findByLabelText('Username or email'), 'learner');
    await user.type(screen.getByLabelText('Password'), 'password8'); await user.click(screen.getByRole('button', { name: mode }));
    expect(await screen.findByText('Guest progress saved to your account: 1 word and 2 games.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/progress/claim', expect.objectContaining({ body: expect.stringContaining('"status":"KNOWN"') }));
    expect(window.localStorage.getItem(LOCAL_WORDS_KEY)).toBeNull(); expect(window.localStorage.getItem(LAST_GAME_KEY)).toBe(gameId);
    await user.click(screen.getByRole('button', { name: 'Games' }));
    expect(await screen.findByRole('row', { name: 'paper' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /definition hint.*1 coin/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Words' }));
    await user.click(await screen.findByRole('tab', { name: 'My Word List' }));
    expect(await screen.findByText('chair')).toBeInTheDocument(); expect(screen.getByText(/Familiarity 5\/5/)).toBeInTheDocument();
  });
  it('keeps authentication successful when transfer fails and offers a retry without losing progress', async () => {
    let attempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/auth/me')) return new Response('{}', { status: 401 });
      if (path.endsWith('/auth/login')) return Response.json({ user: account });
      if (path.endsWith('/progress/claim')) return ++attempts === 1 ? Response.json({ message: 'Temporarily unavailable.' }, { status: 503 }) : Response.json({ wordsAdded: 1, wordsAlreadySaved: 0, gamesTransferred: 1, resumeGameId: gameId });
      if (path.endsWith(`/games/${gameId}`)) return Response.json(game);
      throw new Error(`Unexpected request: ${path}`);
    }); stubFetchWithVocabularyRanges( fetchMock); const user = userEvent.setup(); render(<App />);
    await user.type(await screen.findByLabelText('Username or email'), 'learner'); await user.type(screen.getByLabelText('Password'), 'password8');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You’re signed in, but guest progress has not finished saving.');
    expect(screen.getByText('Signed in as learner')).toBeInTheDocument(); expect(window.localStorage.getItem(LOCAL_WORDS_KEY)).toContain('chair');
    expect(window.localStorage.getItem(TRANSFER_KEY)).not.toBeNull(); expect(window.localStorage.getItem(LAST_GAME_KEY)).toBe(gameId);
    await user.click(screen.getByRole('button', { name: 'Retry saving progress' }));
    expect(await screen.findByText('Guest progress saved to your account: 1 word and 1 game.')).toBeInTheDocument();
    const transfers = fetchMock.mock.calls.filter(call => String(call[0]).endsWith('/progress/claim')); expect(transfers).toHaveLength(2);
    expect(window.localStorage.getItem(TRANSFER_KEY)).toBeNull();
  });
  it('resumes a pending transfer after reloading with an existing account session', async () => {
    window.localStorage.setItem(TRANSFER_KEY, JSON.stringify({ accountId: account.id, source: window.localStorage.getItem(LOCAL_WORDS_KEY), lastGameId: gameId, batches: [{ id: crypto.randomUUID(), words: [{ term: word.term, definition: word.definition, status: word.status, partOfSpeech: null }] }], next: 0, result: { wordsAdded: 0, wordsAlreadySaved: 0, gamesTransferred: 0, resumeGameId: null } }));
    stubFetchWithVocabularyRanges( vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/auth/me')) return Response.json(account);
      if (path.endsWith('/progress/claim')) return Response.json({ wordsAdded: 1, wordsAlreadySaved: 0, gamesTransferred: 1, resumeGameId: gameId });
      if (path.endsWith(`/games/${gameId}`)) return Response.json(game);
      throw new Error(`Unexpected request: ${path}`);
    })); render(<App />);
    expect(await screen.findByText('Guest progress saved to your account: 1 word and 1 game.')).toBeInTheDocument();
    await waitFor(() => expect(window.localStorage.getItem(TRANSFER_KEY)).toBeNull()); expect(window.localStorage.getItem(LAST_GAME_KEY)).toBe(gameId);
  });
});
