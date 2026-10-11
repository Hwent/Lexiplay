import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WordListsPanel from './WordListsPanel';
import { clearDictionaryCache, rememberDictionaryDefinition } from './dictionary-cache';

const list = { id: 'list-1', name: 'Cloud words', words: [] };

describe('vocabulary list panel', () => {
  afterEach(() => {
    cleanup();
    clearDictionaryCache();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('keeps added and status changes local until leaving the route', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([list]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'word-1', term: 'apple', definition: 'A fruit', status: 'UNFAMILIAR' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<WordListsPanel pageMode />);
    await screen.findByRole('heading', { name: 'Cloud words' });
    const addToggle = screen.getByRole('button', { name: /^add$/i });
    await waitFor(() => expect(addToggle).toBeEnabled());
    await user.click(addToggle);
    expect(addToggle).toHaveAttribute('aria-expanded', 'true');
    await user.type(await screen.findByRole('textbox', { name: /^word$/i }), 'apple');
    await user.type(screen.getByRole('textbox', { name: /definition/i }), 'A fruit');
    const addForm = screen.getByRole('textbox', { name: /definition/i }).closest('form')!;
    await user.click(within(addForm).getByRole('button', { name: /^add$/i }));
    expect(await screen.findByText('apple')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unfamiliar' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Unfamiliar' }));
    expect(await screen.findByRole('button', { name: 'Known' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Known' }));
    expect(screen.getByRole('button', { name: 'Unfamiliar' })).toHaveAttribute('aria-pressed', 'false');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new Event('lexiplay:before-route-change')); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/word-lists/list-1/words', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ term: 'apple', definition: 'A fruit' }),
    }));
  });

  it('searches the dictionary and adds a matched entry as unfamiliar', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/word-lists')) return new Response(JSON.stringify([list]), { status: 200 });
      if (path.includes('/dictionary?q=apple')) return new Response(JSON.stringify([
        { term: 'apple', partOfSpeech: ['noun'] },
      ]), { status: 200 });
      if (path.endsWith('/dictionary/apple/definition')) return new Response(JSON.stringify({ definition: 'The round fruit of a tree of the rose family.' }), { status: 200 });
      if (path.endsWith('/list-1/dictionary')) return new Response(JSON.stringify({ id: 'word-1', term: 'apple', definition: 'The round fruit of a tree of the rose family.', status: 'UNFAMILIAR' }), { status: 201 });
      throw new Error(`Unexpected request ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<WordListsPanel pageMode searchQuery="apple" />);
    await screen.findByRole('button', { name: 'apple' });
    expect(screen.queryByText(/select the word to/i)).not.toBeInTheDocument();
    expect(screen.queryByText('noun')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /wiktionary/i })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([path]) => String(path).endsWith('/dictionary/apple/definition'))).toBe(false);
    await user.click(screen.getByRole('button', { name: 'apple' }));
    expect(await screen.findByText('The round fruit of a tree of the rose family.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /save apple to word list/i }));
    expect(await screen.findByText(/apple added as unfamiliar/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unfamiliar' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([path]) => path === '/api/v1/word-lists/list-1/dictionary')).toBe(false);
    await act(async () => { window.dispatchEvent(new Event('lexiplay:before-route-change')); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/word-lists/list-1/dictionary', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ term: 'apple' }),
    })));
  });

  it('reuses API search results and definitions after navigating to another page', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/word-lists')) return new Response(JSON.stringify([list]));
      if (path.includes('/dictionary?q=apple')) return new Response(JSON.stringify([{ term: 'apple', partOfSpeech: ['noun'] }]));
      if (path.endsWith('/dictionary/apple/definition')) return new Response(JSON.stringify({ definition: 'A dictionary fruit.' }));
      throw new Error(`Unexpected request ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const page = render(<WordListsPanel pageMode searchQuery="apple" />);
    await user.click(await screen.findByRole('button', { name: 'apple' }));
    expect(await screen.findByText('A dictionary fruit.')).toBeInTheDocument();
    page.unmount();
    render(<WordListsPanel searchQuery=" APPLE " />);
    await user.click(await screen.findByRole('button', { name: 'apple' }));
    expect(await screen.findByText('A dictionary fruit.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([path]) => String(path).includes('/dictionary?q='))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([path]) => String(path).endsWith('/definition'))).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /load definition/i })).not.toBeInTheDocument();
  });

  it('uses game-cached definitions while preserving a conflicting personal definition', async () => {
    rememberDictionaryDefinition('apple', 'The canonical dictionary fruit.');
    const saved = { ...list, words: [{ id: 'word-1', term: 'apple', definition: 'My own definition.', status: 'KNOWN' }] };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/word-lists')) return new Response(JSON.stringify([saved]));
      return new Response(JSON.stringify([{ term: 'apple', partOfSpeech: ['noun'] }]));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<WordListsPanel pageMode searchQuery="apple" />);
    await user.click(await screen.findByRole('button', { name: 'apple' }));
    expect(await screen.findByText('The canonical dictionary fruit.')).toBeInTheDocument();
    expect(screen.getByText('My own definition.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Already in word list' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'apple' }));
    await act(async () => { window.dispatchEvent(new Event('lexiplay:before-route-change')); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText('My own definition.')).toBeInTheDocument();
  });

  it('rejects a repeated manual word without overwriting its definition', async () => {
    const saved = { ...list, words: [{ id: 'word-1', term: 'apple', definition: 'My own definition.', status: 'KNOWN' }] };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([saved]))));
    const user = userEvent.setup();
    render(<WordListsPanel pageMode />);
    await screen.findByText('My own definition.');
    await waitFor(() => expect(screen.getByRole('button', { name: /^add$/i })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /^add$/i }));
    await user.type(screen.getByRole('textbox', { name: /^word$/i }), 'APPLE');
    await user.type(screen.getByRole('textbox', { name: /definition/i }), 'A conflicting definition.');
    await user.click(within(screen.getByRole('textbox', { name: /definition/i }).closest('form')!).getByRole('button', { name: /^add$/i }));
    expect(await screen.findByText(/saved definition has been kept/i)).toBeInTheDocument();
    expect(screen.getAllByText('apple')).toHaveLength(1);
    expect(screen.getByText('My own definition.')).toBeInTheDocument();
  });

  it('keeps signed-out additions on this device and restores them after remounting', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    const firstRender = render(<WordListsPanel pageMode />);
    await screen.findByText('Your words are saved on this device.');
    await user.click(screen.getByRole('button', { name: /^add$/i }));
    await user.type(screen.getByRole('textbox', { name: /^word$/i }), 'localword');
    await user.type(screen.getByRole('textbox', { name: /definition/i }), 'A local definition');
    const addForm = screen.getByRole('textbox', { name: /definition/i }).closest('form')!;
    await user.click(within(addForm).getByRole('button', { name: /^add$/i }));
    expect(await screen.findByText('localword')).toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('lexiplay-local-word-lists') ?? '[]')[0].words[0]).toMatchObject({
      term: 'localword', definition: 'A local definition',
    }));

    firstRender.unmount();
    render(<WordListsPanel pageMode />);
    expect(await screen.findByText('localword')).toBeInTheDocument();
  });

  it('shows 20 saved words per page and returns to the first page when searching', async () => {
    const words = Array.from({ length: 45 }, (_, index) => ({
      id: `word-${index}`, term: `word${String.fromCharCode(97 + Math.floor(index / 26), 97 + index % 26)}`,
      definition: 'A saved word.', status: 'UNFAMILIAR',
    }));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).endsWith('/word-lists') ? [{ ...list, words }] : []))));
    const user = userEvent.setup();
    const page = render(<WordListsPanel pageMode />);
    await screen.findByText('wordaa');
    expect(screen.getAllByRole('listitem')).toHaveLength(20);
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('wordau')).toBeInTheDocument();
    expect(screen.queryByText('wordaa')).not.toBeInTheDocument();
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    page.rerender(<WordListsPanel pageMode searchQuery="wordaa" />);
    expect(await screen.findByText('wordaa')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByRole('navigation', { name: 'Word list pages' })).not.toBeInTheDocument();
  });

  it('truncates a long dictionary definition when a signed-out user saves it locally', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/word-lists')) return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 });
      if (path.includes('/dictionary?q=longword')) return new Response(JSON.stringify([
        { term: 'longword', partOfSpeech: ['noun'] },
      ]), { status: 200 });
      if (path.endsWith('/dictionary/longword/definition')) return new Response(JSON.stringify({ definition: `${'A'.repeat(450)}; ${'B'.repeat(250)}; discarded third sense` }), { status: 200 });
      throw new Error(`Unexpected request ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<WordListsPanel pageMode searchQuery="longword" />);
    await screen.findByRole('button', { name: 'longword' });
    await user.click(screen.getByRole('button', { name: 'longword' }));
    await screen.findByRole('button', { name: /save longword to word list/i });
    await user.click(screen.getByRole('button', { name: /save longword to word list/i }));
    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem('lexiplay-local-word-lists') ?? '[]')[0].words[0];
      expect(saved.definition).toBe(`${'A'.repeat(450)}; ${'B'.repeat(47)}…`);
    });
  });

  it('previews an uploaded word file and confirms the selected rows', async () => {
    const preview = { rows: [{ rowNumber: 1, term: 'apple', definition: 'A fruit', partOfSpeech: null, selected: true, issues: [] }], totals: { ready: 1, warnings: 0, rejected: 0 } };
    const updatedList = { ...list, words: [{ id: 'word-1', term: 'apple', definition: 'A fruit', status: 'UNFAMILIAR' }] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([list]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(preview), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ added: 1, duplicates: 0 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(updatedList), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<WordListsPanel pageMode />);
    await screen.findByRole('heading', { name: 'Cloud words' });
    const uploadToggle = screen.getByRole('button', { name: /^upload$/i });
    await waitFor(() => expect(uploadToggle).toBeEnabled());
    await user.click(uploadToggle);
    const upload = await screen.findByLabelText(/upload word list/i);
    await user.upload(upload, new File(['apple — A fruit'], 'words.txt', { type: 'text/plain' }));
    await user.click(screen.getByRole('button', { name: /preview import/i }));
    expect(await screen.findByText('A fruit')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /include apple/i })).toBeChecked();

    await user.click(screen.getByRole('button', { name: /import 1 word/i }));
    expect(await screen.findByText(/1 word added/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/word-lists/list-1/import-preview', expect.objectContaining({ method: 'POST' }));
    const confirmBody = JSON.parse(fetchMock.mock.calls[2]![1]!.body as string) as { rows: { term: string; selected: boolean }[] };
    expect(confirmBody.rows).toMatchObject([{ term: 'apple', selected: true }]);
  });
});
