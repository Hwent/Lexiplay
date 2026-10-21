import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

describe('completed games', () => {
  beforeEach(() => { localStorage.clear(); history.replaceState({}, '', '/games'); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  const ladder = { startWord: 'cold', startDefinition: 'At a low temperature.', targetWords: 4 };
  function fixture(kind: string, status: string) {
    return { id: 'completion', kind, ...(kind === 'word-ladder' ? { ladder } : {}), wordLength: 4, attemptLimit: kind === 'word-ladder' ? 4 : 6,
      difficulty: 'medium', status, completed: status !== 'active', answer: status === 'active' ? undefined : 'warm', answerDefinition: 'At a comfortable temperature.',
      guesses: (status === 'won' && kind === 'word-ladder' ? ['cord', 'card', 'ward', 'warm'] : ['cord', 'card', 'ward']).map(guess => ({ guess, definition: `Definition of ${guess}.`, feedback: ['ABSENT','ABSENT','CORRECT','ABSENT'], completed: false })),
      hints: { definition: 1 }, revealedPresent: [], revealedAbsent: [] };
  }
  function mockGame(kind: string, status: string, auth: 'guest' | 'account' | 'error' = 'guest') {
    localStorage.setItem('lexiplay-last-game', 'completion');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/auth/me')) return auth === 'account' ? Response.json({ id: 'learner', username: 'learner' }) : new Response('{}', { status: auth === 'error' ? 503 : 401 });
      if (path.endsWith('/games/wallet')) return Response.json({ coinBalance: 10, kind: auth === 'account' ? 'account' : 'guest' });
      if (path.endsWith('/games/completion')) return Response.json(fixture(kind, status));
      if (path.endsWith('/games') && init?.method === 'POST') return Response.json({ ...fixture(kind, 'active'), id: 'replay' });
      if (path.endsWith('/guesses')) return Response.json({ guess: 'warm', definition: 'At a comfortable temperature.', feedback: Array(4).fill('CORRECT'), completed: true, outcome: 'WON', answer: 'warm', answerDefinition: 'At a comfortable temperature.', rewardCoins: kind === 'word-ladder' ? 4 : 5, attemptsRemaining: kind === 'word-ladder' ? 0 : 2 });
      return Response.json([]);
    }));
  }

  it.each(['word-puzzle', 'word-ladder'])('places %s actions immediately below its board and above definitions', async kind => {
    mockGame(kind, 'won');
    const user = userEvent.setup(); render(<App/>);
    const dialog = await screen.findByRole('dialog', { name: 'Keep your progress.' });
    expect(dialog).toHaveFocus();
    expect(within(dialog).getByLabelText('New accounts start with 100 coins.')).toHaveTextContent('100 coins');
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(within(dialog).getByRole('button', { name: 'Continue as guest' })).toHaveFocus();
    await user.keyboard('{Tab}');
    expect(within(dialog).getByRole('button', { name: 'Create account' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
    const actions = screen.getByRole('group', { name: 'Game actions' });
    const board = screen.getByRole('grid', { name: kind === 'word-ladder' ? 'Word ladder board' : '4-letter puzzle board' });
    expect(actions.previousElementSibling === board || actions.previousElementSibling?.contains(board)).toBe(true);
    const definitions = screen.getByRole('complementary', { name: 'Word definitions' });
    expect(actions.compareDocumentPosition(definitions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(actions).getByRole('button', { name: 'Play again' })).toHaveFocus();
    expect(within(actions).getByRole('button', { name: 'Change settings' })).toBeInTheDocument();
    expect(within(actions).getByRole('link', { name: 'Sign in to save your game history.' })).toBeInTheDocument();
  });

  it.each(['word-puzzle', 'word-ladder'])('reminds guests after winning %s and again after a replay', async kind => {
    mockGame(kind, 'active');
    const user = userEvent.setup(); render(<App/>);
    await screen.findByRole('textbox', { name: /four-letter guess/i });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.keyboard('warm');
    let dialog = await screen.findByRole('dialog', { name: 'Keep your progress.' });
    await user.click(within(dialog).getByRole('button', { name: 'Continue as guest' }));
    const replay = screen.getByRole('button', { name: 'Play again' });
    await waitFor(() => expect(replay).toBeEnabled());
    await user.click(replay);
    await screen.findByRole('textbox', { name: /four-letter guess/i });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.keyboard('warm');
    dialog = await screen.findByRole('dialog', { name: 'Keep your progress.' });
    expect(within(dialog).getByLabelText('New accounts start with 100 coins.')).toBeVisible();
  });

  it.each(['word-puzzle', 'word-ladder'])('offers the reminder after losing %s', async kind => {
    mockGame(kind, 'lost'); render(<App/>);
    expect(await screen.findByRole('dialog', { name: 'Keep your progress.' })).toBeInTheDocument();
  });

  it.each([
    { auth: 'account', status: 'won' }, { auth: 'guest', status: 'cancelled' }, { auth: 'guest', status: 'active' }, { auth: 'error', status: 'won' },
  ] as const)('does not prompt auth=$auth status=$status', async ({ auth, status }) => {
    mockGame('word-puzzle', status, auth); render(<App/>);
    await screen.findByText('medium · 4 letters');
    await waitFor(() => expect(screen.getByRole('region', { name: 'Vocabulary puzzle' })).toHaveAttribute('aria-busy', 'false'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each(['Create account', 'Sign in'])('opens the correct account form from %s', async action => {
    mockGame('word-ladder', 'won');
    const user = userEvent.setup(); render(<App/>);
    const dialog = await screen.findByRole('dialog', { name: 'Keep your progress.' });
    await user.click(within(dialog).getByRole('button', { name: action }));
    expect(location.pathname).toBe('/account');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: action })).toHaveAttribute('aria-selected', 'true');
    if (action === 'Create account') {
      expect(screen.getByLabelText('Username')).toBeInTheDocument();
      expect(screen.getByLabelText('New accounts start with 100 coins.')).toBeVisible();
    } else expect(screen.getByLabelText('Username or email')).toBeInTheDocument();
  });
});
