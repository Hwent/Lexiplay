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

  it('shows each definition with its matching part of speech', async () => {
    const senses = [{ partOfSpeech: 'noun', definitions: ['A drop from an eye.'] }, { partOfSpeech: 'verb', definitions: ['To rip apart.'] }];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/word-lists')) return Response.json([list]);
      if (path.includes('/dictionary?q=tear')) return Response.json([{ term: 'tear', partOfSpeech: ['noun', 'verb'], senses }]);
      return Response.json({ definition: 'noun: A drop from an eye.\nverb: To rip apart.' });
    }));
    const user = userEvent.setup();
    render(<WordListsPanel pageMode searchQuery="tear" />);
    await user.click(await screen.findByRole('button', { name: 'tear' }));
    const noun = await screen.findByRole('region', { name: 'noun definitions' });
    const verb = screen.getByRole('region', { name: 'verb definitions' });
    expect(within(noun).getByText('A drop from an eye.')).toBeInTheDocument();
    expect(within(noun).queryByText('To rip apart.')).not.toBeInTheDocument();
    expect(within(verb).getByText('To rip apart.')).toBeInTheDocument();
  });

  it('keeps status changes local until leaving the route', async () => {
    const word = { id: 'word-1', term: 'apple', definition: 'A fruit', status: 'UNFAMILIAR' };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json([{ ...list, words: [word] }]))
      .mockResolvedValueOnce(Response.json({ ...word, status: 'KNOWN' }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<WordListsPanel pageMode />);
    expect(await screen.findByText('apple')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unfamiliar' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Unfamiliar' }));
    expect(await screen.findByRole('button', { name: 'Known' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Known' }));
    expect(screen.getByRole('button', { name: 'Unfamiliar' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Unfamiliar' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new Event('lexiplay:before-route-change')); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/word-lists/list-1/words/word-1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ status: 'KNOWN' }),
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

  it('skips pasted words already saved without overwriting personal definitions', async () => {
    const saved = { ...list, words: [{ id: 'word-1', term: 'apple', definition: 'My own definition.', status: 'KNOWN' }] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json([saved]))
      .mockResolvedValueOnce(Response.json({ rows: [{ rowNumber: 1, term: 'apple', definition: 'A conflicting definition.', partOfSpeech: null, selected: true, issues: [] }], totals: { ready: 1, warnings: 0, rejected: 0 } }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<WordListsPanel pageMode />);
    await screen.findByText('My own definition.');
    await user.click(screen.getByRole('button', { name: /^upload$/i }));
    await user.click(screen.getByRole('textbox', { name: 'Paste your words' }));
    await user.paste('APPLE: A conflicting definition.');
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    expect(await screen.findByText('Already in list')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Include apple' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Include apple' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Import 0 words' })).toBeDisabled();
    expect(screen.getByText('My own definition.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps signed-out additions on this device and restores them after remounting', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/import-preview')
      ? Response.json({ rows: [{ rowNumber: 1, term: 'localword', definition: 'A local definition', partOfSpeech: null, selected: true, issues: [] }], totals: { ready: 1, warnings: 0, rejected: 0 } })
      : new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    const firstRender = render(<WordListsPanel pageMode />);
    await screen.findByText('Your words are saved on this device.');
    await waitFor(() => expect(screen.getByRole('button', { name: /^upload$/i })).toBeEnabled());
    expect(screen.queryByRole('button', { name: /^add$/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^upload$/i }));
    await user.click(screen.getByRole('textbox', { name: 'Paste your words' }));
    await user.paste('localword: A local definition');
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    await user.click(await screen.findByRole('button', { name: 'Import 1 word' }));
    expect(await screen.findByText('localword')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([path]) => String(path).endsWith('/import'))).toBe(false);
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

  it('previews pasted words, imports only selected rows, and clears the input', async () => {
    const rows = [
      { rowNumber: 1, term: 'apple', definition: 'A fruit', partOfSpeech: null, selected: true, issues: [] },
      { rowNumber: 2, term: 'brave', definition: 'Showing courage', partOfSpeech: null, selected: true, issues: [] },
      { rowNumber: 3, term: 'bad123', definition: '', partOfSpeech: null, selected: false, issues: ['INVALID_TERM'] },
      { rowNumber: 4, term: 'apple', definition: '', partOfSpeech: null, selected: false, issues: ['DUPLICATE_IN_FILE'] },
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json([list]))
      .mockResolvedValueOnce(Response.json({ rows, totals: { ready: 2, warnings: 1, rejected: 1 } }))
      .mockResolvedValueOnce(Response.json({ added: 1, duplicates: 0 }))
      .mockResolvedValueOnce(Response.json({ ...list, words: [{ id: 'word-1', term: 'brave', definition: 'Showing courage', status: 'UNFAMILIAR' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<WordListsPanel pageMode />);
    await screen.findByRole('heading', { name: 'Cloud words' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    expect(screen.getByRole('button', { name: 'Preview import' })).toBeDisabled();
    const input = screen.getByRole('textbox', { name: 'Paste your words' });
    const text = 'apple — A fruit\nbrave: Showing courage\nbad123\napple';
    await user.click(input);
    await user.paste(text);
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    expect(await screen.findByRole('button', { name: 'Import 2 words' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Include bad123' })).toBeDisabled();
    expect(screen.getAllByRole('checkbox', { name: 'Include apple' })[1]).toBeDisabled();
    const form = fetchMock.mock.calls[1]![1]!.body as FormData;
    const file = form.get('file') as File;
    expect(file.name).toBe('pasted-words.txt');
    const submittedText = await new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(file);
    });
    expect(submittedText).toBe(text);
    await user.click(screen.getAllByRole('checkbox', { name: 'Include apple' })[0]!);
    await user.click(screen.getByRole('button', { name: 'Import 1 word' }));
    expect(await screen.findByText('1 word added.')).toBeInTheDocument();
    const body = JSON.parse(fetchMock.mock.calls[2]![1]!.body as string);
    expect(body.rows.filter((row: { selected: boolean }) => row.selected)).toEqual([rows[1]]);
    expect(screen.getByText('brave')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Paste your words' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    expect(screen.getByRole('textbox', { name: 'Paste your words' })).toHaveValue('');
  });

  it('clears a stale preview when the pasted text or import source changes and recovers from errors', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json([list]))
      .mockResolvedValueOnce(Response.json({ message: 'Could not read these words.' }, { status: 400 }))
      .mockImplementation(async () => Response.json({ rows: [{ rowNumber: 1, term: 'apple', definition: '', partOfSpeech: null, selected: true, issues: [] }], totals: { ready: 1, warnings: 0, rejected: 0 } }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<WordListsPanel pageMode />);
    await screen.findByRole('heading', { name: 'Cloud words' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    const input = screen.getByRole('textbox', { name: 'Paste your words' });
    await user.type(input, 'apple');
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    expect(await screen.findByText('Could not read these words.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    await screen.findByRole('button', { name: 'Import 1 word' });
    await user.type(input, '\nchair');
    expect(screen.queryByRole('table', { name: 'Import preview' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    await screen.findByRole('button', { name: 'Import 1 word' });
    await user.click(screen.getByRole('button', { name: 'Upload file' }));
    expect(screen.queryByRole('table', { name: 'Import preview' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview import' })).toBeDisabled();
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
    await user.click(screen.getByRole('button', { name: 'Upload file' }));
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

  it('prepares bulk pasted words, supports select-all and clearing, and blocks oversized batches', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json([list]))
      .mockResolvedValueOnce(Response.json({ rows: [
        { rowNumber: 1, term: 'apple', definition: '', partOfSpeech: null, selected: true, issues: [] },
        { rowNumber: 2, term: 'brave', definition: '', partOfSpeech: null, selected: true, issues: [] },
        { rowNumber: 3, term: 'bad123', definition: '', partOfSpeech: null, selected: false, issues: ['INVALID_TERM'] },
      ], totals: { ready: 2, warnings: 0, rejected: 1 } }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<WordListsPanel pageMode />);
    await screen.findByRole('heading', { name: 'Cloud words' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    const input = screen.getByRole('textbox', { name: 'Paste your words' });
    await user.click(input);
    await user.paste('• apple, brave\nbad123');
    expect(screen.getByText('3 / 1,000 entries')).toBeInTheDocument();
    await user.keyboard('{Control>}{Enter}{/Control}');
    await screen.findByRole('button', { name: 'Import 2 words' });
    const file = (fetchMock.mock.calls[1]![1]!.body as FormData).get('file') as File;
    const text = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(file); });
    expect(text).toBe('apple\nbrave\nbad123');
    const selectAll = screen.getByRole('checkbox', { name: 'Select all ready words' });
    await user.click(selectAll);
    expect(screen.getByRole('button', { name: 'Import 0 words' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Include bad123' })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Include apple' }));
    expect(selectAll).toBePartiallyChecked();
    await user.click(selectAll);
    expect(screen.getByRole('button', { name: 'Import 2 words' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Clear text' }));
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    expect(screen.queryByRole('table', { name: 'Import preview' })).not.toBeInTheDocument();
    await user.paste(Array(1001).fill('apple').join(','));
    expect(screen.getByText(/1,001 \/ 1,000 entries/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview import' })).toBeDisabled();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps meaning punctuation intact and invalidates the preview when paste format changes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json([list]))
      .mockResolvedValueOnce(Response.json({ rows: [{ rowNumber: 1, term: 'apple', definition: 'A fruit, usually red; also green.', partOfSpeech: null, selected: true, issues: [] }], totals: { ready: 1, warnings: 0, rejected: 0 } }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<WordListsPanel pageMode />);
    await screen.findByRole('heading', { name: 'Cloud words' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    await user.click(screen.getByRole('radio', { name: 'Words and meanings' }));
    await user.click(screen.getByRole('textbox', { name: 'Paste your words' }));
    await user.paste('1. apple: A fruit, usually red; also green.');
    expect(screen.getByText('1 / 1,000 entries')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Preview import' }));
    await screen.findByRole('button', { name: 'Import 1 word' });
    const file = (fetchMock.mock.calls[1]![1]!.body as FormData).get('file') as File;
    const text = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(file); });
    expect(text).toBe('apple: A fruit, usually red; also green.');
    await user.click(screen.getByRole('radio', { name: 'Words only' }));
    expect(screen.queryByRole('table', { name: 'Import preview' })).not.toBeInTheDocument();
    expect(screen.getByText('3 / 1,000 entries')).toBeInTheDocument();
  });
});
