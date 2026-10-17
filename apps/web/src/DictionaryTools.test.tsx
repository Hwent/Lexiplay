import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DictionaryTools from './DictionaryTools';
import { importTerms } from './dictionary-import';
import { PendingWords } from './services/pending-words';
import { PendingWordsContext } from './usePendingWords';
import { searchDictionary } from './dictionary-cache';
vi.mock('./dictionary-cache', () => ({ normalizeTerm: (value: string) => value.trim().toLowerCase(), searchDictionary: vi.fn(async () => [{ term: 'cover', partOfSpeech: ['verb'], senses: [{ partOfSpeech: 'verb', definitions: ['To place over.'] }] }]) }));
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function renderTools(store: PendingWords, query = '') {
  return render(<PendingWordsContext.Provider value={store}><DictionaryTools listId="my-list" searchQuery={query}/></PendingWordsContext.Provider>);
}
it('starts a real dictionary lookup from the empty-state example', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ terms: [] })));
  const user = userEvent.setup(); renderTools(new PendingWords('user'));
  await user.click(screen.getByRole('button', { name: 'Try “curious”' }));
  expect(screen.getByRole('searchbox', { name: 'Search the dictionary' })).toHaveValue('curious');
  await waitFor(() => expect(searchDictionary).toHaveBeenCalledWith('curious'));
});
it('debounces rapid typing and cancels a queued search when switching to imports', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ terms: [] })));
  const search = vi.mocked(searchDictionary);
  search.mockClear();
  renderTools(new PendingWords('user'));
  const input = screen.getByRole('searchbox', { name: 'Search the dictionary' });
  for (const value of ['co', 'cov', 'cove', 'cover']) fireEvent.change(input, { target: { value } });
  await act(() => vi.advanceTimersByTimeAsync(299));
  expect(search).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(search).toHaveBeenCalledExactlyOnceWith('cover');
  fireEvent.change(input, { target: { value: 'apple' } });
  fireEvent.click(screen.getByRole('button', { name: 'Import words' }));
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(search).toHaveBeenCalledOnce();
});
it('parses word files, deduplicates terms and leaves supplied definitions out', () => {
  expect(importTerms('word,definition\nCover,Personal note\ncover,Other note\n"analyse",My text', 'csv')).toEqual(['Cover', 'cover', 'analyse']);
  expect(importTerms('term\tdefinition\ncover\tPrivate text', 'tsv')).toEqual(['cover']);
  expect(importTerms('all right\n COVER \ncover')).toEqual(['all right', 'COVER', 'cover']);
  expect(importTerms('word\nterm')).toEqual(['word', 'term']);
});
it('reads a CSV file into a word-only preview without saving automatically', async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ terms: [] })); vi.stubGlobal('fetch', fetchMock);
  const user = userEvent.setup(); renderTools(new PendingWords('user'));
  await user.click(screen.getByRole('button', { name: 'Import words' }));
  const file = new File(['word,definition\ncover,Private note'], 'words.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'text', { value: async () => 'word,definition\ncover,Private note\ncover,Other note' });
  await user.upload(screen.getByLabelText('Choose a word file'), file);
  await waitFor(() => expect(screen.getByLabelText('Words to import')).toHaveValue('cover'));
  expect(screen.getByText('1 unique word')).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false);
});
it('adds and cancels selections without requests and shows Saved only after an exit commit', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => Response.json(String(input).endsWith('/saved-terms') ? { terms: [] } : { added: 1, skipped: 0, missing: [] })); vi.stubGlobal('fetch', fetchMock);
  const store = new PendingWords('user'), user = userEvent.setup(); renderTools(store, 'cover');
  await user.click(await screen.findByRole('button', { name: 'Add cover' }));
  expect(screen.getByRole('button', { name: 'Cancel addition of cover' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Saved cover' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Cancel addition of cover' }));
  expect(screen.getByRole('button', { name: 'Add cover' })).toBeEnabled();
  expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Add cover' })); await act(() => store.flush());
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/word-lists/my-list/dictionary-entries', expect.objectContaining({ method: 'POST', body: JSON.stringify({ terms: ['cover'] }) }));
  expect(await screen.findByRole('button', { name: 'Saved cover' })).toBeDisabled();
});
it('stages word imports and reports missing dictionary matches only when committed on exit', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => Response.json(String(input).endsWith('/saved-terms') ? { terms: [] } : { added: 1, skipped: 0, missing: ['zzunknown'] })); vi.stubGlobal('fetch', fetchMock);
  const store = new PendingWords('user'), user = userEvent.setup(); renderTools(store);
  await user.click(screen.getByRole('button', { name: 'Import words' }));
  await user.type(screen.getByLabelText('Words to import'), 'cover\ncover\nzzunknown');
  await user.click(screen.getByRole('button', { name: 'Select dictionary matches' }));
  expect(screen.getByText(/2 new words selected/)).toBeInTheDocument();
  expect(store.getSnapshot().pending.size).toBe(2);
  await act(() => store.flush()); expect(store.getSnapshot().notice).toContain('zzunknown');
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/word-lists/my-list/dictionary-entries', expect.objectContaining({ body: JSON.stringify({ terms: ['cover', 'zzunknown'] }) }));
});
it('recognizes previously saved words when tools are reopened and reuses the membership request', async () => {
  const fetchMock = vi.fn(async () => Response.json({ terms: ['cover'] })); vi.stubGlobal('fetch', fetchMock);
  const store = new PendingWords('user'), first = renderTools(store, 'cover');
  expect(await screen.findByRole('button', { name: 'Saved cover' })).toBeDisabled(); first.unmount();
  renderTools(store, 'cover'); expect(await screen.findByRole('button', { name: 'Saved cover' })).toBeDisabled();
  expect(fetchMock).toHaveBeenCalledOnce();
});
