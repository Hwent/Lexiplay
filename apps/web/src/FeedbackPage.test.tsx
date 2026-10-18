import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import FeedbackPage from './FeedbackPage';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('rejects whitespace, prevents duplicate submissions, and confirms successful feedback', async () => {
  let finish!: (value: Response) => void;
  const fetchMock = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal('fetch', fetchMock);
  const user = userEvent.setup();
  render(<FeedbackPage />);
  const input = screen.getByRole('textbox', { name: 'Your message' });
  const send = screen.getByRole('button', { name: 'Send feedback' });
  expect(send).toBeDisabled();
  await user.type(input, '   ');
  expect(send).toBeDisabled();
  await user.clear(input);
  await user.type(input, '  Please add more puzzles.  ');
  await user.click(send);
  expect(input).toBeDisabled();
  fireEvent.submit(input.closest('form')!);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/feedback', expect.objectContaining({ method: 'POST', body: JSON.stringify({ content: 'Please add more puzzles.' }), credentials: 'same-origin' }));
  await act(async () => { finish(Response.json({ id: 'message', createdAt: new Date().toISOString() })); });
  expect(screen.getByRole('status')).toHaveTextContent('Your feedback has been received.');
  await user.click(screen.getByRole('button', { name: 'Send another message' }));
  expect(screen.getByRole('textbox', { name: 'Your message' })).toHaveValue('');
  expect(screen.getByRole('textbox', { name: 'Your message' })).toHaveAttribute('maxlength', '2000');
});

it('keeps the message for retry when submission fails', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ message: 'Please try again later.' }, { status: 429 })).mockResolvedValueOnce(Response.json({ id: 'message' }));
  vi.stubGlobal('fetch', fetchMock);
  const user = userEvent.setup();
  render(<FeedbackPage />);
  await user.type(screen.getByRole('textbox', { name: 'Your message' }), 'Keep this message.');
  await user.click(screen.getByRole('button', { name: 'Send feedback' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Please try again later.');
  expect(screen.getByRole('textbox', { name: 'Your message' })).toHaveValue('Keep this message.');
  await user.click(screen.getByRole('button', { name: 'Send feedback' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Your feedback has been received.');
});
