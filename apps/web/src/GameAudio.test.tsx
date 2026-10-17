import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { gameAudio } from './services/game-audio';
import { stubFetchWithVocabularyRanges } from './vocabulary-range-test-fixtures';

beforeEach(() => { localStorage.clear(); history.replaceState({}, '', '/games'); });
afterEach(() => { cleanup(); gameAudio.setEnabled(true); localStorage.clear(); vi.unstubAllGlobals(); });

it('plays input and result cues once, including rewards, without replaying a restored win', async () => {
  const play = vi.spyOn(gameAudio, 'play');
  let guesses = 0;
  let balance = 10;
  const game = { id: 'sound-game', wordLength: 5, attemptLimit: 6, guesses: [], hints: { synonym: 1, definition: 1 }, revealedAbsent: [], revealedPresent: [] };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/auth/me')) return new Response('{}', { status: 401 });
    if (path.endsWith('/games/wallet')) return Response.json({ coinBalance: balance, kind: 'guest' });
    if (path.endsWith('/guesses')) {
      guesses++;
      if (guesses === 1) return Response.json({ code: 'INVALID_GUESS', message: 'Invalid word' }, { status: 400 });
      if (guesses === 2) return Response.json({ guess: 'crane', feedback: Array(5).fill('ABSENT'), completed: false });
      balance = 15;
      return Response.json({ guess: 'plant', feedback: Array(5).fill('CORRECT'), completed: true, outcome: 'WON', answer: 'plant', rewardCoins: 5 });
    }
    if (path.endsWith('/hints')) return Response.json({ type: 'definition', text: 'Something that grows.', hints: { synonym: 1, definition: 0 }, cost: 1 });
    if (path.endsWith('/games') || path.endsWith('/games/sound-game')) return Response.json(guesses === 3 ? { ...game, completed: true, status: 'won', answer: 'plant' } : game);
    return Response.json([]);
  }));
  const user = userEvent.setup();
  const view = render(<App />);
  await waitFor(() => expect(screen.getByRole('button', { name: /start practice/i })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: /start practice/i }));
  const input = await screen.findByRole('textbox', { name: /five-letter guess/i });
  play.mockClear();
  await user.click(screen.getByRole('button', { name: 'Delete letter' }));
  await user.keyboard('{Control>}a{/Control}1');
  expect(play).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'X' }));
  await user.click(screen.getByRole('button', { name: 'Delete letter' }));
  await user.type(input, 'xxxxx');
  await screen.findByText(/XXXXX is not in the dictionary/);
  expect(play.mock.calls.map(([sound]) => sound)).toEqual(['type', 'delete', 'type', 'type', 'type', 'type', 'type', 'invalid']);
  await user.keyboard('{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}crane');
  await screen.findByRole('row', { name: 'crane' });
  expect(play.mock.calls.filter(([sound]) => sound === 'guess')).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: /definition hint.*1 coin/i }));
  await screen.findByText('Something that grows.');
  expect(play.mock.calls.filter(([sound]) => sound === 'hint')).toHaveLength(1);
  await user.type(input, 'plant');
  await screen.findByText(/You found it!/);
  await waitFor(() => expect(play).toHaveBeenCalledWith('coin'));
  expect(play.mock.calls.filter(([sound]) => sound === 'win')).toHaveLength(1);
  expect(play.mock.calls.filter(([sound]) => sound === 'coin')).toHaveLength(1);
  view.unmount(); play.mockClear();
  render(<App />);
  await screen.findByText(/Solved in/);
  expect(play).not.toHaveBeenCalled();
});

it('keeps the sound setting when navigating and reopening the app', async () => {
  history.replaceState({}, '', '/settings');
  stubFetchWithVocabularyRanges(vi.fn(async () => new Response('{}', { status: 401 })));
  const user = userEvent.setup();
  const view = render(<App />);
  const toggle = await screen.findByRole('switch', { name: 'Sound effects' });
  expect(toggle).toBeChecked();
  await user.click(toggle);
  expect(toggle).not.toBeChecked();
  expect(localStorage.getItem('lexiplay-sound-enabled')).toBe('false');
  await user.click(screen.getByRole('button', { name: 'Home' }));
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  expect(await screen.findByRole('switch', { name: 'Sound effects' })).not.toBeChecked();
  view.unmount();
  render(<App />);
  expect(await screen.findByRole('switch', { name: 'Sound effects' })).not.toBeChecked();
});
