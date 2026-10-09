import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

describe('practice puzzle', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('starts a game and submits a guess with server feedback', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'game-1', wordLength: 5, attemptLimit: 6, guesses: [] }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Enter a valid five-letter word from the practice dictionary.' }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ guess: 'crane', feedback: ['ABSENT', 'ABSENT', 'CORRECT', 'CORRECT', 'ABSENT'], attemptsRemaining: 5, completed: false }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ guess: 'plant', feedback: ['CORRECT', 'CORRECT', 'CORRECT', 'CORRECT', 'CORRECT'], attemptsRemaining: 4, completed: true, outcome: 'WON', answer: 'plant' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'game-2', wordLength: 5, attemptLimit: 6, guesses: [] }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await user.click(screen.getByRole('button', { name: /start practice/i }));
    const guessInput = await screen.findByRole('textbox', { name: /five-letter guess/i });
    await user.type(guessInput, 'xxxxx');
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/valid five-letter word/i)).toBeInTheDocument();
    expect(screen.getByText(/6 guesses remaining/i)).toBeInTheDocument();
    await user.clear(guessInput);
    await user.type(guessInput, 'crane');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(await screen.findByText('crane')).toBeInTheDocument();
    expect(screen.getByText(/5 guesses remaining/i)).toBeInTheDocument();

    await user.type(guessInput, 'plant');
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/you found it/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try another word/i }));
    expect(await screen.findByRole('textbox', { name: /five-letter guess/i })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
