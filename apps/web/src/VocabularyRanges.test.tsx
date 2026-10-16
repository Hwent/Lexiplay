import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import App from './App';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('offers practice without requesting or selecting vocabulary ranges', async () => {
  window.localStorage.clear(); window.history.replaceState({}, '', '/games');
  const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response('{}', { status: 401 }));
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);
  expect(screen.queryByRole('combobox', { name: 'Vocabulary range' })).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: /Start practice/ })).toBeEnabled());
  expect(fetchMock.mock.calls.every(args => !String(args[0]).includes('vocabulary-ranges'))).toBe(true);
});
