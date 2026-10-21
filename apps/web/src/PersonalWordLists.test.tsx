import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import PersonalWordLists from './PersonalWordLists';
const list = { id: 'list-1', name: 'My words', isDefault: true, preferredLanguage: 'en', wordCount: 26 };
const word = { id: 'entry-1', dictionaryEntryId: 'word-1', lemma: 'analyse', partOfSpeech: 'verb', stage: 'Core', definition: 'To examine carefully.', language: 'en', definitionSource: 'dictionary', familiarity: 4, nextReviewAt: null };
const page = { list, page: 1, pageSize: 25, total: 26, words: [word] };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('opens and unsaves collection cards without removing saved words', async () => {
  const collection = { id: 'a2', slug: 'cefr-a2', name: 'CEFR A2', level: 'A2', wordCount: 793 };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'DELETE') return Response.json({ success: true });
    if (String(input).endsWith('/collections')) return Response.json([collection]);
    return Response.json(String(input).endsWith('/mine') ? [list] : page);
  });
  vi.stubGlobal('fetch', fetchMock);
  const onOpenCollection = vi.fn(), user = userEvent.setup();
  render(<PersonalWordLists signedIn searchQuery="" initialId="list-1" revision={0} onOpenCollection={onOpenCollection}/>);
  const collections = await screen.findByRole('region', { name: 'My collections' });
  expect(within(collections).getByRole('heading', { name: 'CEFR A2' })).toBeInTheDocument();
  expect(within(collections).getByText('793 words')).toBeInTheDocument();
  await user.click(within(collections).getByRole('button', { name: 'Open CEFR A2' }));
  expect(onOpenCollection).toHaveBeenCalledWith('cefr-a2');
  await user.click(within(collections).getByRole('button', { name: 'Unsave CEFR A2' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'My collections' })).not.toBeInTheDocument());
  expect(screen.queryByText(/Collection removed/)).not.toBeInTheDocument();
  expect(await screen.findByText('To examine carefully.')).toBeInTheDocument();
});
it('shows dictionary content without definition editing', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => Response.json(String(input).endsWith('/mine') ? [list] : page)));
  render(<PersonalWordLists signedIn searchQuery="" initialId="list-1" revision={0}/>);
  await screen.findByText('To examine carefully.');
  expect(screen.queryByRole('button', { name: 'Edit definition' })).not.toBeInTheDocument();
  expect(screen.queryByText(/Next review:/)).not.toBeInTheDocument();
});
it('gives an empty word list a clear next step without table or pagination controls', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => Response.json(String(input).endsWith('/mine') ? [list] : { ...page, total: 0, words: [] })));
  render(<PersonalWordLists signedIn searchQuery="" initialId="list-1" revision={0}/>);
  expect(await screen.findByRole('heading', { name: 'Your word list is ready for a fresh start.' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Find words' })).toHaveAttribute('href', '/dictionary');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: /Personal list pages/ })).not.toBeInTheDocument();
});
it('hides previous entries while a new page loads and applies the header search', async () => {
  let finish!: (value: Response) => void;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/mine')) return Response.json([list]);
    if (path.includes('page=2')) return new Promise<Response>(resolve => { finish = resolve; });
    return Response.json(page);
  });
  vi.stubGlobal('fetch', fetchMock);
  const user = userEvent.setup();
  render(<PersonalWordLists signedIn searchQuery="analyse" initialId="list-1" revision={0}/>);
  await screen.findByText('To examine carefully.');
  expect(fetchMock.mock.calls.some(([path]) => String(path).includes('q=analyse'))).toBe(true);
  await user.click(screen.getAllByRole('button', { name: 'Next' })[0]!);
  expect(screen.queryByText('To examine carefully.')).not.toBeInTheDocument();
  await waitFor(() => expect(finish).toBeDefined());
  finish(Response.json({ ...page, page: 2, words: [{ ...word, lemma: 'analysis', definition: 'A careful examination.' }] }));
  await screen.findByText('A careful examination.');
});
it('keeps entries visible during a review write and never sends custom definition fields', async () => {
  let finish!: (value: Response) => void;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/mine')) return Response.json([list]);
    if (init?.method === 'PATCH') return new Promise<Response>(resolve => { finish = resolve; });
    return Response.json(page);
  });
  vi.stubGlobal('fetch', fetchMock);
  const user = userEvent.setup();
  render(<PersonalWordLists signedIn searchQuery="" initialId="list-1" revision={0}/>);
  await screen.findByText('To examine carefully.');
  await user.click(screen.getByRole('button', { name: 'Reviewed' }));
  expect(screen.getByText('To examine carefully.')).toBeInTheDocument();
  expect(screen.getByText('Familiarity 5/5')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reviewed' })).toBeDisabled();
  const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
  expect(JSON.parse(String(patch[1]?.body))).toMatchObject({ familiarity: 5, nextReviewAt: expect.any(String) });
  await act(async () => { finish(Response.json({ success: true })); });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Reviewed' })).toBeEnabled());
  expect(fetchMock.mock.calls.filter(([path]) => String(path).includes('/entries?'))).toHaveLength(1);
  expect(screen.queryByText('Your review was saved.')).not.toBeInTheDocument();
});

it.each(['Reviewed', 'Review again'])('rolls back a failed %s without hiding the table', async action => {
  let finish!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PATCH') return new Promise<Response>(resolve => { finish = resolve; });
    return Response.json(String(input).endsWith('/mine') ? [list] : page);
  }));
  const user = userEvent.setup();
  render(<PersonalWordLists signedIn searchQuery="" initialId="list-1" revision={0}/>);
  await screen.findByText('Familiarity 4/5');
  await user.click(screen.getByRole('button', { name: action }));
  expect(screen.getByText(action === 'Reviewed' ? 'Familiarity 5/5' : 'Familiarity 0/5')).toBeInTheDocument();
  await act(async () => { finish(Response.json({ message: 'Offline' }, { status: 503 })); });
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
  expect(screen.getByText('Familiarity 4/5')).toBeInTheDocument();
  expect(screen.getByRole('table')).toBeInTheDocument();
});

it.each([true, false])('removes only the selected row, restoring it on failure (success=%s)', async success => {
  let finish!: (value: Response) => void;
  const other = { ...word, id: 'entry-2', lemma: 'cover' };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'DELETE') return new Promise<Response>(resolve => { finish = resolve; });
    return Response.json(String(input).endsWith('/mine') ? [list] : { ...page, words: [word, other] });
  });
  vi.stubGlobal('fetch', fetchMock);
  const user = userEvent.setup();
  render(<PersonalWordLists signedIn searchQuery="" initialId="list-1" revision={0}/>);
  const table = await screen.findByRole('table');
  await user.click(screen.getByRole('button', { name: 'Remove analyse' }));
  expect(screen.queryByRole('button', { name: 'Remove analyse' })).not.toBeInTheDocument();
  expect(screen.getByRole('table')).toBe(table);
  expect(screen.getByRole('button', { name: 'Remove cover' })).toBeEnabled();
  await act(async () => { finish(Response.json(success ? { success: true } : { message: 'Offline' }, { status: success ? 200 : 503 })); });
  if (success) expect(screen.queryByRole('button', { name: 'Remove analyse' })).not.toBeInTheDocument();
  else expect(await screen.findByRole('button', { name: 'Remove analyse' })).toBeEnabled();
  expect(fetchMock.mock.calls.filter(([path]) => String(path).includes('/entries?'))).toHaveLength(1);
  expect(fetchMock.mock.calls.some(([path]) => String(path).endsWith('/saved-terms'))).toBe(false);
});

it('keeps Previous available after removing the only word on the final page', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'DELETE') return Response.json({ success: true });
    if (String(input).endsWith('/mine')) return Response.json([list]);
    return Response.json({ ...page, page: String(input).includes('page=2') ? 2 : 1 });
  }));
  const user = userEvent.setup();
  render(<PersonalWordLists signedIn searchQuery="" initialId="list-1" revision={0}/>);
  await screen.findByRole('table');
  await user.click(screen.getAllByRole('button', { name: 'Next' })[0]!);
  await screen.findByRole('table');
  await user.click(screen.getByRole('button', { name: 'Remove analyse' }));
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Previous' })[0]).toBeEnabled());
  await user.click(screen.getAllByRole('button', { name: 'Previous' })[0]!);
  expect(await screen.findByRole('table')).toBeInTheDocument();
});
