import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DictionaryPage from './DictionaryPage';
import { PendingWords } from './services/pending-words';
import { PendingWordsContext } from './usePendingWords';
import { clearDictionaryCache } from './dictionary-cache';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); clearDictionaryCache(); vi.unstubAllGlobals(); });

it('lets guests look up definitions and pronunciation without requesting a personal list', async () => {
  const fetchMock = vi.fn(async () => Response.json([{ term: 'curious', partOfSpeech: ['adjective'], definition: 'Eager to learn.' }]));
  vi.stubGlobal('fetch', fetchMock);
  const user = userEvent.setup();
  render(<DictionaryPage signedIn={false} accountLoading={false} />);
  await user.type(screen.getByRole('searchbox', { name: 'Search the dictionary' }), 'curious');
  expect(await screen.findByText('Eager to learn.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Pronounce curious' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add curious' })).toBeDisabled();
  expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/account');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('keeps lookup available after a word-list failure and retries saving to the default list', async () => {
  let listUnavailable = true;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/mine')) return listUnavailable ? Response.json({ message: 'Word list unavailable' }, { status: 503 }) : Response.json([{ id: 'other' }, { id: 'default-list', isDefault: true }]);
    if (path.endsWith('/saved-terms')) return Response.json({ terms: [] });
    if (path.endsWith('/dictionary-entries')) return Response.json({ added: 1, skipped: 0, missing: [] });
    return Response.json([{ term: 'curious', partOfSpeech: ['adjective'], definition: 'Eager to learn.' }]);
  });
  vi.stubGlobal('fetch', fetchMock);
  const store = new PendingWords('learner');
  const user = userEvent.setup();
  render(<PendingWordsContext.Provider value={store}><DictionaryPage signedIn accountLoading={false} /></PendingWordsContext.Provider>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Word list unavailable');
  expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  await user.type(screen.getByRole('searchbox', { name: 'Search the dictionary' }), 'curious');
  expect(await screen.findByText('Eager to learn.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add curious' })).toBeDisabled();
  listUnavailable = false;
  await user.click(screen.getByRole('button', { name: 'Retry word list' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add curious' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Add curious' }));
  expect(screen.getByRole('button', { name: 'Cancel addition of curious' })).toBeInTheDocument();
  await act(() => store.flush());
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/word-lists/default-list/dictionary-entries', expect.objectContaining({ method: 'POST', body: JSON.stringify({ terms: ['curious'] }) }));
});
