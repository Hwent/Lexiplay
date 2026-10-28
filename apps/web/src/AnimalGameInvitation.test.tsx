import { StrictMode } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import AnimalGameInvitation, { ANIMAL_INVITATION_KEY } from './AnimalGameInvitation';

beforeEach(() => {
  localStorage.clear();
  history.replaceState({}, '', '/games');
  localStorage.setItem('lexiplay-interface-preferences', JSON.stringify({ language: 'en', fontSize: 'medium' }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mockAccount(signedIn = false, completed = false) {
  if (completed) localStorage.setItem('lexiplay-last-game', 'completed');
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/auth/me')) return signedIn ? Response.json({ id: 'learner', username: 'learner' }) : new Response('{}', { status: 401 });
    if (path.endsWith('/games/wallet')) return Response.json({ coinBalance: 10, kind: signedIn ? 'account' : 'guest' });
    if (path.endsWith('/games/completed')) return Response.json({ id: 'completed', kind: 'word-puzzle', wordLength: 4, attemptLimit: 6, status: 'won', completed: true, answer: 'warm', answerDefinition: 'At a comfortable temperature.', guesses: [], hints: { definition: 1 }, revealedAbsent: [], revealedPresent: [] });
    return Response.json([]);
  }));
}

it.each([false, true])('invites first-time visitors with signedIn=%s and opens Guess Animal', async signedIn => {
  mockAccount(signedIn);
  const user = userEvent.setup();
  render(<StrictMode><App/></StrictMode>);
  const dialog = await screen.findByRole('dialog', { name: 'Try Guess Animal' });
  expect(dialog).toHaveFocus();
  expect(document.querySelector('.app-shell')).toHaveAttribute('inert');
  expect(localStorage.getItem(ANIMAL_INVITATION_KEY)).toBe('true');
  await user.click(within(dialog).getByRole('button', { name: 'Play Guess Animal' }));
  expect(location.pathname).toBe('/games/animal-guess');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(document.querySelector('.app-shell')).not.toHaveAttribute('inert');
  expect(document.body.style.overflow).toBe('');
});

it('shows only once even if the page reloads before dismissal', async () => {
  mockAccount();
  const first = render(<App/>);
  await screen.findByRole('dialog', { name: 'Try Guess Animal' });
  first.unmount();
  render(<App/>);
  await waitFor(() => expect(screen.getByRole('button', { name: /start practice/i })).toBeEnabled());
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('supports keyboard focus trapping and dismissal, without prompting again on navigation', async () => {
  mockAccount();
  const user = userEvent.setup();
  render(<App/>);
  const dialog = await screen.findByRole('dialog', { name: 'Try Guess Animal' });
  await user.keyboard('{Shift>}{Tab}{/Shift}');
  expect(within(dialog).getByRole('button', { name: 'Maybe later' })).toHaveFocus();
  await user.keyboard('{Tab}');
  expect(within(dialog).getByRole('button', { name: 'Play Guess Animal' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Guess Animal' }));
  expect(location.pathname).toBe('/games/animal-guess');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('uses Chinese copy for the Chinese interface', async () => {
  mockAccount();
  localStorage.setItem('lexiplay-interface-preferences', JSON.stringify({ language: 'zh-CN', fontSize: 'medium' }));
  const user = userEvent.setup();
  render(<App/>);
  const dialog = await screen.findByRole('dialog', { name: '来玩猜动物吧' });
  expect(within(dialog).getByText('心里想一种动物，回答几个问题，看看我能不能猜中！')).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: '下次再玩' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('waits for the existing game reminder instead of stacking dialogs', async () => {
  mockAccount(false, true);
  const user = userEvent.setup();
  render(<App/>);
  const reminder = await screen.findByRole('dialog', { name: 'Keep your progress.' });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(localStorage.getItem(ANIMAL_INVITATION_KEY)).toBeNull();
  await user.click(within(reminder).getByRole('button', { name: 'Continue as guest' }));
  await screen.findByRole('dialog', { name: 'Try Guess Animal' });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
});

it('can still be dismissed when browser storage is unavailable', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
  const onDismiss = vi.fn();
  const user = userEvent.setup();
  render(<AnimalGameInvitation onDismiss={onDismiss} onPlay={vi.fn()}/>);
  await user.click(screen.getByRole('button', { name: 'Maybe later' }));
  expect(onDismiss).toHaveBeenCalledOnce();
});
