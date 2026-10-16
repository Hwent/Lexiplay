import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import CollectionPicker from './CollectionPicker';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('shows playable words for the selected length and collection without a browse link', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const wordLength = Number(new URL(String(input), 'http://localhost').searchParams.get('wordLength'));
    return Response.json({ wordLength, totalWords: 100, collections: [
      { id: 'a2', slug: 'cefr-a2', name: 'CEFR A2', wordCount: wordLength === 5 ? 12 : 3 },
      { id: 'c2', slug: 'cefr-c2', name: 'CEFR C2', wordCount: 0 },
    ] });
  });
  vi.stubGlobal('fetch', fetchMock);
  const onChange = vi.fn(), user = userEvent.setup();
  const { rerender } = render(<CollectionPicker value="" wordLength={5} disabled={false} onChange={onChange}/>);
  expect(await screen.findByLabelText('Playable words')).toHaveTextContent('100 words');
  expect(screen.queryByRole('button', { name: 'Browse collections' })).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'CEFR C2 · 0 words' })).toBeDisabled();
  await user.selectOptions(screen.getByLabelText('Collection'), 'cefr-a2');
  expect(onChange).toHaveBeenCalledWith('cefr-a2');
  rerender(<CollectionPicker value="cefr-a2" wordLength={5} disabled={false} onChange={onChange}/>);
  expect(screen.getByLabelText('Playable words')).toHaveTextContent('12 words');
  rerender(<CollectionPicker value="cefr-a2" wordLength={6} disabled={false} onChange={onChange}/>);
  await waitFor(() => expect(screen.getByLabelText('Playable words')).toHaveTextContent('3 words'));
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/collections/game-options?wordLength=6', expect.anything());
});

it('reuses loaded lengths instead of hitting rate limits after repeated changes', async () => {
  const seen = new Set<number>();
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const wordLength = Number(new URL(String(input), 'http://localhost').searchParams.get('wordLength'));
    if (seen.has(wordLength)) return Response.json({ message: 'ThrottlerException: Too Many Requests' }, { status: 429 });
    seen.add(wordLength);
    return Response.json({ wordLength, totalWords: wordLength * 10, collections: [] });
  });
  vi.stubGlobal('fetch', fetchMock);
  const { rerender } = render(<CollectionPicker value="" wordLength={5} disabled={false} onChange={() => {}}/>);
  for (const length of [5, 6, 5, 6, 5]) {
    rerender(<CollectionPicker value="" wordLength={length} disabled={false} onChange={() => {}}/>);
    await waitFor(() => expect(screen.getByLabelText('Playable words')).toHaveTextContent(`${length * 10} words`));
  }
  expect(screen.queryByText('Collections could not be loaded.')).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('keeps collection choices available and retries after a rate limit', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ message: 'Too many requests' }, { status: 429 }))
    .mockResolvedValueOnce(Response.json({ wordLength: 5, totalWords: 50, collections: [] }));
  vi.stubGlobal('fetch', fetchMock);
  const user = userEvent.setup();
  render(<CollectionPicker value="" wordLength={5} disabled={false} onChange={() => {}}/>);
  expect(await screen.findByText('Word counts are busy. Try again shortly.')).toBeInTheDocument();
  expect(screen.getByLabelText('Collection')).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Retry counts' }));
  expect(await screen.findByLabelText('Playable words')).toHaveTextContent('50 words');
});
