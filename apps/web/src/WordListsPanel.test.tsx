import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WordListsPanel from './WordListsPanel';

const list = { id: 'list-1', name: 'My words', words: [] };

describe('vocabulary list panel', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('adds a word and lets the learner mark it as known', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([list]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'word-1', term: 'apple', definition: 'A fruit', status: 'UNFAMILIAR' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'word-1', term: 'apple', definition: 'A fruit', status: 'UNFAMILIAR' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<WordListsPanel pageMode />);
    await user.type(await screen.findByRole('textbox', { name: /^word$/i }), 'apple');
    await user.type(screen.getByRole('textbox', { name: /definition/i }), 'A fruit');
    await user.click(screen.getByRole('button', { name: /add word/i }));
    expect(await screen.findByText('apple')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unfamiliar' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Unfamiliar' }));
    expect(await screen.findByRole('button', { name: 'Known' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Known' }));
    expect(screen.getByRole('button', { name: 'Unfamiliar' })).toHaveAttribute('aria-pressed', 'false');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { window.dispatchEvent(new Event('lexiplay:before-route-change')); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/word-lists/list-1/words/word-1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ status: 'UNFAMILIAR' }),
    }));
  });

  it('searches the dictionary and adds a matched entry as unfamiliar', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/word-lists')) return new Response(JSON.stringify([list]), { status: 200 });
      if (path.includes('/dictionary?q=apple')) return new Response(JSON.stringify([
        { term: 'apple', definition: 'The round fruit of a tree of the rose family.', partOfSpeech: ['noun'] },
      ]), { status: 200 });
      if (path.endsWith('/list-1/dictionary')) return new Response(JSON.stringify({ id: 'word-1', term: 'apple', definition: 'The round fruit of a tree of the rose family.', status: 'UNFAMILIAR' }), { status: 201 });
      throw new Error(`Unexpected request ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<WordListsPanel pageMode searchQuery="apple" />);
    expect(await screen.findByText('The round fruit of a tree of the rose family.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /add to list/i }));
    expect(await screen.findByText(/apple added as unfamiliar/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unfamiliar' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/word-lists/list-1/dictionary', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ term: 'apple' }),
    }));
  });

  it('previews an uploaded word file and confirms the selected rows', async () => {
    const preview = { rows: [{ rowNumber: 1, term: 'apple', definition: 'A fruit', partOfSpeech: null, example: null, selected: true, issues: [] }], totals: { ready: 1, warnings: 0, rejected: 0 } };
    const updatedList = { ...list, words: [{ id: 'word-1', term: 'apple', definition: 'A fruit', status: 'UNFAMILIAR' }] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([list]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(preview), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ added: 1, duplicates: 0 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(updatedList), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<WordListsPanel pageMode />);
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
