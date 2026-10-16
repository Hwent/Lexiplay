import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';

beforeEach(() => { localStorage.clear(); history.replaceState({}, '', '/'); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('prefetches every word count before opening setup and reuses them across lengths', async () => {
  const counts = vi.fn(async () => Response.json(Array.from({ length: 7 }, (_, index) => ({ wordLength: index + 3, totalWords: (index + 3) * 10, collections: [] }))));
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/auth/me')) return Response.json({}, { status: 401 });
    if (path.endsWith('/games/wallet')) return Response.json({ coinBalance: 10, kind: 'guest' });
    if (path.endsWith('/collections/game-options/all')) return counts();
    return Response.json({});
  }));
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() => expect(counts).toHaveBeenCalledOnce());
  await user.click(screen.getByRole('button', { name: 'Games' }));
  expect(screen.getByLabelText('Playable words')).toHaveTextContent('50 words');
  for (const length of [3, 9, 4, 7, 6, 8, 5]) {
    await user.click(screen.getByRole('radio', { name: `${length} letters` }));
    expect(screen.getByLabelText('Playable words')).toHaveTextContent(`${length * 10} words`);
  }
  expect(counts).toHaveBeenCalledOnce();
});
