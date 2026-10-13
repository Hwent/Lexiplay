import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { TEST_VOCABULARY_RANGES } from './vocabulary-range-test-fixtures';

const baseGame = { id: 'range-game', wordLength: 5, difficulty: 'medium', attemptLimit: 6, guesses: [], hints: { unused: 2, present: 2 }, revealedAbsent: [], revealedPresent: [] };

describe('vocabulary practice ranges', () => {
  beforeEach(() => { window.localStorage.clear(); window.history.replaceState({}, '', '/games'); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('loads ranges, starts IELTS practice with the selected range, and shows its label during play', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/auth/me')) return new Response('{}', { status: 401 });
      if (path.endsWith('/vocabulary-ranges')) return Response.json(TEST_VOCABULARY_RANGES);
      if (path.endsWith('/word-lists')) return Response.json([]);
      return Response.json({ ...baseGame, vocabularyRange: 'ielts', vocabularyRangeLabel: 'IELTS practice' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<App />);
    const picker = screen.getByRole('combobox', { name: 'Vocabulary range' });
    await waitFor(() => expect(picker).toBeEnabled());
    expect(screen.getByRole('option', { name: 'Primary school' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Grade 12' })).toBeInTheDocument();
    await user.selectOptions(picker, 'ielts');
    expect(screen.getByText('2 answer words available at 5 letters.')).toBeInTheDocument();
    expect(screen.getByText(/levels are approximate, not official exam lists/)).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Play with my words' }));
    expect(screen.getByText('Your saved words are filtered by this range.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /start practice/i }));
    expect(await screen.findByText('Vocab range: IELTS practice')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/games', expect.objectContaining({ body: JSON.stringify({ kind: 'word-puzzle', wordLength: 5, difficulty: 'medium', playWithMyWords: true, vocabularyRange: 'ielts' }) }));
    await user.click(screen.getByRole('button', { name: 'Choose a new puzzle' }));
    expect(screen.getByRole('combobox', { name: 'Vocabulary range' })).toHaveValue('ielts');
    expect(fetchMock.mock.calls.filter(([path]) => String(path).endsWith('/vocabulary-ranges'))).toHaveLength(1);
  });

  it('moves to an available word length and disables unavailable ranges and lengths', async () => {
    const ranges = TEST_VOCABULARY_RANGES.map(range => range.id === 'cefr-b1-b2' ? { ...range, wordCounts: Object.fromEntries([3, 4, 5, 6, 7, 8, 9].map(length => [length, 0])) } : range);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/vocabulary-ranges') ? Response.json(ranges) : new Response('{}', { status: 401 })));
    const user = userEvent.setup();
    render(<App />);
    const picker = screen.getByRole('combobox', { name: 'Vocabulary range' });
    await waitFor(() => expect(picker).toBeEnabled());
    expect(screen.getByRole('option', { name: 'CEFR B1–B2 — unavailable' })).toBeDisabled();
    await user.selectOptions(picker, 'cefr-c1-c2');
    expect(screen.getByRole('radio', { name: '9 letters' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '5 letters' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: '3 letters' })).toBeDisabled();
    expect(screen.getByText('2 answer words available at 9 letters.')).toBeInTheDocument();
  });

  it('restores the range label and keeps the same range when choosing the next puzzle', async () => {
    window.localStorage.setItem('lexiplay-last-game', baseGame.id);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/auth/me')) return new Response('{}', { status: 401 });
      if (path.endsWith('/vocabulary-ranges')) return Response.json(TEST_VOCABULARY_RANGES);
      return Response.json({ ...baseGame, wordLength: 9, vocabularyRange: 'cefr-c1-c2', vocabularyRangeLabel: 'CEFR C1–C2' });
    }));
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText('Vocab range: CEFR C1–C2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Choose a new puzzle' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Vocabulary range' })).toHaveValue('cefr-c1-c2'));
    expect(screen.getByRole('radio', { name: '9 letters' })).toBeChecked();
  });

  it('offers a retry when range availability fails to load', async () => {
    let requests = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/vocabulary-ranges')
      ? ++requests === 1 ? Response.json({ message: 'Unavailable' }, { status: 503 }) : Response.json(TEST_VOCABULARY_RANGES)
      : new Response('{}', { status: 401 })));
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load vocabulary ranges.');
    expect(screen.getByRole('combobox', { name: 'Vocabulary range' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Retry ranges' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Vocabulary range' })).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(requests).toBe(2);
  });
});
