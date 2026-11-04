import { StrictMode } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';

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

it.each([false, true])('keeps Guess Animal available without an invitation for signedIn=%s', async signedIn => {
  mockAccount(signedIn);
  const user = userEvent.setup();
  render(<StrictMode><App/></StrictMode>);
  await waitFor(() => expect(screen.getByRole('button', { name: /start practice/i })).toBeEnabled());
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(document.querySelector('.app-shell')).not.toHaveAttribute('inert');
  await user.click(screen.getByRole('button', { name: 'Guess Animal' }));
  expect(location.pathname).toBe('/games/animal-guess');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
