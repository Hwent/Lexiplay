import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../App';
import { LanguageContext } from '../i18n';
import AnimalGuessGame from './AnimalGuessGame';
import { answerQuestion, newSession, nextTurn, restoreSession, saveSession, type Session } from './engine';
import { animals, featureValue } from './knowledge';
import { englishKeywordMeanings } from './keyword-meanings';

beforeEach(() => { localStorage.clear(); history.replaceState({}, '', '/games/animal-guess'); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const bookmark = (term: string) => <button type="button">Save {term}</button>;

function readyToGuess(id: string): Session {
  const animal = animals.find(item => item.id === id)!;
  let session = newSession();
  for (let index = 0; index < 15; index++) {
    const turn = nextTurn(session);
    if (turn.kind !== 'question') break;
    const value = featureValue(animal, turn.question.id);
    session = answerQuestion(session, value === 'unknown' ? 'not-sure' : value);
  }
  return session;
}

it('starts a free round in Chinese UI while keeping questions in English and explaining keywords on demand', async () => {
  const user = userEvent.setup(), fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  render(<LanguageContext.Provider value="zh-CN"><AnimalGuessGame bookmark={bookmark}/></LanguageContext.Provider>);
  expect(screen.getByText('免费游玩')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '我想好了' }));
  const turn = nextTurn(restoreSession()!);
  expect(turn.kind).toBe('question');
  if (turn.kind !== 'question') throw new Error('Expected a question');
  const keyword = Object.keys(turn.question.keywords)[0]!;
  const button = screen.getByRole('button', { name: keyword });
  expect(screen.queryByText(turn.question.keywords[keyword]!, { exact: true })).not.toBeInTheDocument();
  await user.click(button);
  expect(button).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('status')).toHaveTextContent(turn.question.keywords[keyword]!);
  await user.click(screen.getByRole('button', { name: '不确定' }));
  expect(restoreSession()!.answers[0]!.answer).toBe('not-sure');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('explains keywords in English and switches the explanation with the interface language', async () => {
  const user = userEvent.setup();
  const view = render(<LanguageContext.Provider value="en"><AnimalGuessGame bookmark={bookmark}/></LanguageContext.Provider>);
  expect(screen.getByRole('heading', { name: 'Guess Animal' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'I have an animal in mind' }));
  const turn = nextTurn(restoreSession()!);
  if (turn.kind !== 'question') throw new Error('Expected a question');
  const keyword = Object.keys(turn.question.keywords)[0]!;
  expect(screen.getByText('Tap an underlined word for its meaning.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: keyword }));
  expect(screen.getByRole('status')).toHaveTextContent(englishKeywordMeanings[keyword]!);
  expect(screen.getByRole('status')).not.toHaveTextContent(turn.question.keywords[keyword]!);
  view.rerender(<LanguageContext.Provider value="zh-CN"><AnimalGuessGame bookmark={bookmark}/></LanguageContext.Provider>);
  expect(screen.getByRole('status')).toHaveTextContent(turn.question.keywords[keyword]!);
  expect(screen.getByRole('status')).not.toHaveTextContent(englishKeywordMeanings[keyword]!);
});

it('restores the current question after remount and edits the last answer without consuming a question', async () => {
  const user = userEvent.setup();
  const first = answerQuestion(newSession(), 'yes');
  saveSession(first);
  const view = render(<AnimalGuessGame bookmark={bookmark}/>);
  expect(screen.getByText('1 / 15 questions')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Change previous answer' }));
  expect(screen.getByRole('button', { name: 'Yes' })).toHaveAttribute('aria-pressed', 'true');
  await user.click(screen.getByRole('button', { name: 'No' }));
  expect(restoreSession()!.answers).toEqual([{ ...first.answers[0]!, answer: 'no' }]);
  const currentTurn = nextTurn(restoreSession()!);
  view.unmount();
  render(<AnimalGuessGame bookmark={bookmark}/>);
  expect(screen.getByText('1 / 15 questions')).toBeInTheDocument();
  expect(nextTurn(restoreSession()!)).toEqual(currentTurn);
});

it('reveals the guessed Chinese name only on request and shows a bookmarkable result without examples', async () => {
  const user = userEvent.setup();
  saveSession(readyToGuess('tiger'));
  render(<AnimalGuessGame bookmark={bookmark}/>);
  expect(screen.getByRole('heading', { name: /Is it a tiger\s*\?/ })).toBeInTheDocument();
  expect(screen.queryByText('老虎')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Show Chinese' }));
  expect(screen.getByText('老虎')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'You guessed it' }));
  expect(screen.getByRole('heading', { name: 'Found your animal.' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save tiger' })).toBeInTheDocument();
  expect(screen.getByText(animals.find(animal => animal.id === 'tiger')!.definition)).toBeInTheDocument();
  expect(screen.queryByText(/example sentence/i)).not.toBeInTheDocument();
  expect(restoreSession()!.status).toBe('won');
  await user.click(screen.getByRole('button', { name: 'Play again' }));
  expect(restoreSession()!.answers).toHaveLength(0);
  expect(restoreSession()!.guesses).toHaveLength(0);
});

it('keeps the result card in English and only shows the Chinese name in Chinese UI', async () => {
  const session = readyToGuess('tiger');
  saveSession({ ...session, guesses: [{ animalId: 'tiger', correct: true }], status: 'won' });
  const view = render(<LanguageContext.Provider value="en"><AnimalGuessGame bookmark={bookmark}/></LanguageContext.Provider>);
  expect(screen.getByText(animals.find(animal => animal.id === 'tiger')!.definition)).toBeInTheDocument();
  expect(screen.queryByText('老虎')).not.toBeInTheDocument();
  view.rerender(<LanguageContext.Provider value="zh-CN"><AnimalGuessGame bookmark={bookmark}/></LanguageContext.Provider>);
  expect(screen.getByText('老虎')).toBeInTheDocument();
  view.rerender(<LanguageContext.Provider value="en"><AnimalGuessGame bookmark={bookmark}/></LanguageContext.Provider>);
  expect(screen.queryByText('老虎')).not.toBeInTheDocument();
});

it('uses all three guess opportunities after fifteen questions and retries failed feedback without changing the knowledge set', async () => {
  const user = userEvent.setup();
  let session = newSession();
  for (let index = 0; index < 15; index++) session = answerQuestion(session, 'not-sure');
  saveSession(session);
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ message: 'Please try again.' }, { status: 503 })).mockResolvedValueOnce(Response.json({ id: 'feedback-1' }));
  vi.stubGlobal('fetch', fetchMock);
  render(<AnimalGuessGame bookmark={bookmark}/>);
  for (let index = 0; index < 3; index++) await user.click(screen.getByRole('button', { name: 'Not my animal' }));
  expect(screen.getByText('15 / 15 questions')).toBeInTheDocument();
  expect(screen.getByText('3 / 3 guesses')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'You stumped me.' })).toBeInTheDocument();
  const input = screen.getByRole('textbox', { name: 'What animal were you thinking of?' });
  await user.type(input, '独角兽');
  await user.click(screen.getByRole('button', { name: 'Send answer' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Please try again.');
  expect(input).toHaveValue('独角兽');
  await user.click(screen.getByRole('button', { name: 'Send answer' }));
  expect(await screen.findByText('Thanks. Your answer is saved for review.')).toBeInTheDocument();
  expect(screen.getByText(/Not in this starter set yet\./)).toBeInTheDocument();
  const [path, init] = fetchMock.mock.calls[1]!;
  expect(path).toBe('/api/v1/feedback');
  const payload = JSON.parse(init.body);
  expect(payload.content).toContain('独角兽');
  expect(payload.content).toContain('Rejected guesses:');
  expect(payload.content.length).toBeLessThanOrEqual(2000);
  expect(animals).toHaveLength(100);
  expect(restoreSession()!.feedbackSent).toBe(true);
});

it('uses a supplied Chinese answer to show the correct animal after giving up', async () => {
  const user = userEvent.setup();
  saveSession(answerQuestion(newSession(), 'no'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ id: 'feedback-2' })));
  render(<AnimalGuessGame bookmark={bookmark}/>);
  await user.click(screen.getByRole('button', { name: 'Give up' }));
  await user.type(screen.getByRole('textbox', { name: 'What animal were you thinking of?' }), '海豚');
  await user.click(screen.getByRole('button', { name: 'Send answer' }));
  expect(await screen.findByRole('button', { name: 'Save dolphin' })).toBeInTheDocument();
  expect(screen.queryByText('海豚')).not.toBeInTheDocument();
  expect(screen.getByText(animals.find(animal => animal.id === 'dolphin')!.definition)).toBeInTheDocument();
});

it('is reachable from Games, resumes directly by URL and saves to the existing guest word list without charging coins', async () => {
  const user = userEvent.setup();
  const session = readyToGuess('tiger');
  const turn = nextTurn(session);
  if (turn.kind !== 'guess') throw new Error('Expected a guess');
  saveSession({ ...session, guesses: [{ animalId: turn.animal.id, correct: true }], status: 'won' });
  history.replaceState({}, '', '/games');
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith('/auth/me')) return Response.json({}, { status: 401 });
    if (path.endsWith('/games/wallet')) return Response.json({ coinBalance: 0, kind: 'guest' });
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetchMock);
  const view = render(<App/>);
  await user.click(screen.getByRole('button', { name: 'Guess Animal' }));
  expect(location.pathname).toBe('/games/animal-guess');
  expect(screen.getByRole('region', { name: 'Guess Animal' })).toBeInTheDocument();
  view.unmount();
  render(<App/>);
  const save = await screen.findByRole('button', { name: 'Add tiger to word list' });
  await waitFor(() => expect(save).toBeEnabled());
  await user.click(save);
  expect(save).toHaveAttribute('aria-pressed', 'true');
  await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', { name: 'Words' }));
  await waitFor(() => expect(JSON.parse(localStorage.getItem('lexiplay-local-word-lists') ?? '[]')[0]?.words.some((word: { term: string }) => word.term === 'tiger')).toBe(true));
  expect(fetchMock.mock.calls.some(([path]) => String(path).endsWith('/games'))).toBe(false);
});

it('keeps a playable round when local storage is unavailable', () => {
  const setter = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked'); });
  render(<AnimalGuessGame bookmark={bookmark}/>);
  fireEvent.click(screen.getByRole('button', { name: 'I have an animal in mind' }));
  expect(screen.getByText('Progress could not be saved on this device. Keep this page open to finish your round.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Yes' })).toBeEnabled();
  setter.mockRestore();
});

it('keeps an existing paid puzzle intact while playing and resuming the free game', async () => {
  const user = userEvent.setup();
  const paid = { id: 'existing-paid-puzzle', wordLength: 5, difficulty: 'medium', attemptLimit: 6,
    guesses: [{ guess: 'crane', feedback: ['ABSENT', 'PRESENT', 'ABSENT', 'ABSENT', 'ABSENT'] }],
    hints: { definition: 1 }, revealedAbsent: [], revealedPresent: [], status: 'active' };
  localStorage.setItem('lexiplay-last-game', paid.id);
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith('/auth/me')) return Response.json({}, { status: 401 });
    if (path.endsWith('/games/wallet')) return Response.json({ coinBalance: 9, kind: 'guest', activeGameId: paid.id });
    if (path.endsWith(`/games/${paid.id}`)) return Response.json(paid);
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<App/>);
  await user.click(screen.getByRole('button', { name: 'I have an animal in mind' }));
  await user.click(screen.getByRole('button', { name: 'No' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Word puzzle' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Word puzzle' }));
  expect(await screen.findByRole('row', { name: 'crane' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Choose a new puzzle' })).toBeDisabled();
  expect(localStorage.getItem('lexiplay-last-game')).toBe(paid.id);
  await user.click(screen.getByRole('button', { name: 'Guess Animal' }));
  expect(screen.getByText('1 / 15 questions')).toBeInTheDocument();
  expect(screen.getByText('0 / 3 guesses')).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([, init]) => init && 'method' in init && init.method === 'POST')).toBe(false);
});
