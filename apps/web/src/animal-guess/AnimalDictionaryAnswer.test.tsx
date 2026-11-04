import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import AnimalDictionaryAnswer from './AnimalDictionaryAnswer';
import { clearDictionaryCache } from '../dictionary-cache';

beforeEach(() => { localStorage.clear(); clearDictionaryCache(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const bookmark = (term: string, definition: string) => <button title={definition}>Save {term}</button>;

it('retries a failed definition request without resubmitting feedback', async () => {
  const fetchMock = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(Response.json({ definition: 'A small amphibian.' }));
  vi.stubGlobal('fetch', fetchMock);
  const user = userEvent.setup();
  render(<AnimalDictionaryAnswer term="axolotl" bookmark={bookmark}/>);
  await user.click(await screen.findByRole('button', { name: 'Retry search' }));
  expect(await screen.findByRole('button', { name: 'Save axolotl' })).toHaveAttribute('title', 'A small amphibian.');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls.every(([path]) => String(path).endsWith('/dictionary/axolotl/definition'))).toBe(true);
});

it('does not overwrite a newer word with a slower earlier lookup', async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => String(input).includes('/dodo/')
    ? new Promise<Response>(resolve => { finish = resolve; }) : Promise.resolve(Response.json({ definition: 'A small amphibian.' }))));
  const view = render(<AnimalDictionaryAnswer term="dodo" bookmark={bookmark}/>);
  expect(screen.getByRole('status')).toHaveTextContent('Searching the dictionary…');
  view.rerender(<AnimalDictionaryAnswer term="axolotl" bookmark={bookmark}/>);
  await screen.findByText('A small amphibian.');
  await act(async () => { finish(Response.json({ definition: 'An extinct flightless bird.' })); });
  expect(screen.queryByText('An extinct flightless bird.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save axolotl' })).toBeInTheDocument();
});
