import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import WordLadderBoard from './WordLadderBoard';

describe('Word Ladder', () => {
  beforeEach(() => { localStorage.clear(); history.replaceState({}, '', '/games'); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  const ladder = { startWord: 'cold', startDefinition: 'At a low temperature.', targetWords: 4 };
  const game = { id: 'ladder', kind: 'word-ladder', ladder, wordLength: 4, difficulty: 'medium', attemptLimit: 4, status: 'active', guesses: [], hints: { definition: 0 }, revealedAbsent: [], revealedPresent: [], coinPayer: 'guest' };

  it('offers only four and five letters with rewards matching the length, and checks steps with definitions', async () => {
    const starts: Record<string, unknown>[] = [];
    let submissions = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/auth/me')) return new Response('{}', { status: 401 });
      if (path.endsWith('/games/wallet')) return Response.json({ coinBalance: 10, kind: 'guest' });
      if (path.endsWith('/games') && init?.method === 'POST') { starts.push(JSON.parse(String(init.body))); return Response.json(game); }
      if (path.endsWith('/guesses')) {
        submissions++;
        if (submissions === 1) return Response.json({ code: 'INVALID_LADDER_STEP', message: 'Change exactly one letter from the previous word.' }, { status: 400 });
        if (submissions > 2) return Response.json({ code: 'INVALID_GUESS', message: 'Enter a valid 4-letter word from the practice dictionary.' }, { status: 400 });
        return Response.json({ guess: 'cord', definition: 'A thin rope.', feedback: [], completed: false, attemptsRemaining: 3 });
      }
      return Response.json([]);
    }));
    const user = userEvent.setup(); render(<App/>);
    await user.click(screen.getByRole('button', { name: 'Word Ladder' }));
    expect(screen.getByText('How to play').closest('details')).not.toHaveAttribute('open');
    expect(screen.getByRole('img', { name: 'Word Ladder example' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map(input => input.getAttribute('aria-label'))).toEqual(['4 letters', '5 letters']);
    expect(screen.queryByLabelText('Collection')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Difficulty' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Entry: 1 coin. Win: 5 coins')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: '4 letters' }));
    expect(screen.getByLabelText('Entry: 1 coin. Win: 4 coins')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Start ladder' }));
    expect(starts[0]).toMatchObject({ kind: 'word-ladder', wordLength: 4 });
    expect(starts[0]).not.toHaveProperty('collectionId');
    expect(starts[0]).not.toHaveProperty('difficulty');
    const board = await screen.findByRole('grid', { name: 'Word ladder board' });
    expect(within(board).getAllByRole('row')).toHaveLength(5);
    expect(board.querySelector('.correct, .present, .absent')).toBeNull();
    expect(screen.getByText(ladder.startDefinition)).toBeInTheDocument();
    expect(within(board).queryByText('Start')).not.toBeInTheDocument();
    expect(screen.getByText('0 / 4 words')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next word hint · 1 coin' })).toBeEnabled();
    await user.keyboard('warm');
    expect(await screen.findByText('Change exactly one letter from the previous word.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose a new puzzle' })).toBeEnabled();
    expect(within(board).queryByRole('row', { name: 'warm' })).not.toBeInTheDocument();
    await user.keyboard('{Backspace}{Backspace}{Backspace}{Backspace}cord');
    expect(await screen.findByText('A thin rope.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose a new puzzle' })).toBeDisabled();
    expect(within(board).getByRole('row', { name: 'cord' }).querySelectorAll('.neutral')).toHaveLength(4);
    expect(within(board).getByRole('row', { name: 'cord' })).toHaveClass('revealing-guess');
    expect(screen.getByText('1 / 4 words')).toBeInTheDocument();
    await user.keyboard('corz');
    expect(await screen.findByText('CORZ is not in the dictionary. Try another word.')).toBeInTheDocument();
    const rejectedRow = within(board).getByRole('row', { name: 'Next word' });
    expect(rejectedRow).toHaveClass('invalid-guess');
    expect(within(rejectedRow).getAllByRole('gridcell').every(tile => tile.classList.contains('letter-tile'))).toBe(true);
    expect(screen.getByRole('textbox', { name: /four-letter guess/i })).toHaveValue('corz');
    expect(screen.getByText('1 / 4 words')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(submissions).toBe(4));
    expect(within(board).getByRole('row', { name: 'Next word' })).not.toBe(rejectedRow);
  });

  it('fills and checks the next word for one coin, refreshes the wallet, and completes the ladder', async () => {
    localStorage.setItem('lexiplay-last-game', game.id);
    const words = ['cord', 'card', 'ward', 'warm'];
    const submitted: string[] = [];
    let coins = 9;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/auth/me')) return new Response('{}', { status: 401 });
      if (path.endsWith('/games/wallet')) return Response.json({ coinBalance: coins, kind: 'guest' });
      if (path.endsWith('/games/ladder')) return Response.json(game);
      if (path.endsWith('/hints')) {
        expect(JSON.parse(String(init?.body))).toEqual({ type: 'nextWord' });
        coins--;
        return Response.json({ type: 'nextWord', text: words[submitted.length], hints: { definition: 0, nextWord: 0 }, cost: 1 });
      }
      if (path.endsWith('/guesses')) {
        const { guess } = JSON.parse(String(init?.body));
        submitted.push(guess);
        const completed = submitted.length === 4;
        if (completed) coins += 4;
        return Response.json({ guess, feedback: [], definition: `Definition of ${guess}.`, completed, attemptsRemaining: 4 - submitted.length,
          ...(completed ? { outcome: 'WON', answer: guess, rewardCoins: 4 } : {}) });
      }
      return Response.json([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup(); render(<App/>);
    await screen.findByRole('row', { name: 'Next word' });
    await user.keyboard('co');
    for (let step = 0; step < 4; step++) {
      await user.click(await screen.findByRole('button', { name: 'Next word hint · 1 coin' }));
      expect(await screen.findByRole('row', { name: words[step]! })).toBeInTheDocument();
    }
    expect(submitted).toEqual(words);
    expect(await screen.findByRole('button', { name: 'Play again' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Next word hint/ })).not.toBeInTheDocument();
    expect(await screen.findByLabelText('Coin balance: 9')).toBeInTheDocument();
  });

  it('keeps failed hint purchases available and retries a purchased word without another fee', async () => {
    localStorage.setItem('lexiplay-last-game', game.id);
    let hintAttempts = 0, guessAttempts = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/auth/me')) return new Response('{}', { status: 401 });
      if (path.endsWith('/games/wallet')) return Response.json({ coinBalance: 8, kind: 'guest' });
      if (path.endsWith('/games/ladder')) return Response.json(game);
      if (path.endsWith('/hints')) {
        if (++hintAttempts === 1) return Response.json({ message: 'Hint service unavailable.' }, { status: 503 });
        return Response.json({ type: 'nextWord', text: 'cord', hints: { definition: 0, nextWord: 0 }, cost: hintAttempts === 2 ? 1 : 0 });
      }
      if (path.endsWith('/guesses')) {
        if (++guessAttempts === 1) return Response.json({ message: 'Try checking again.' }, { status: 503 });
        return Response.json({ guess: 'cord', feedback: [], definition: 'A thin rope.', completed: false, attemptsRemaining: 3 });
      }
      return Response.json([]);
    }));
    const user = userEvent.setup(); render(<App/>);
    await user.click(await screen.findByRole('button', { name: 'Next word hint · 1 coin' }));
    expect(await screen.findByText('Hint service unavailable.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next word hint · 1 coin' }));
    expect(await screen.findByText('Try checking again.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /four-letter guess/i })).toHaveValue('cord');
    await user.click(screen.getByRole('button', { name: 'Next word hint · Fill word' }));
    expect(await screen.findByText('A thin rope.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next word hint · 1 coin' })).toBeEnabled();
  });

  it('keeps all starting and submitted letters neutral', () => {
    const { container } = render(<WordLadderBoard ladder={ladder} steps={[{ guess: 'cord' }, { guess: 'card' }, { guess: 'ward' }]} guess="" finished={false} busy={false}/>);
    expect(screen.getAllByRole('row')).toHaveLength(5);
    expect(container.querySelectorAll('.neutral')).toHaveLength(16);
    expect(container.querySelector('.correct, .present, .absent')).toBeNull();
  });

  it.each([
    { startWord: 'cold', words: ['cord', 'card', 'ward', 'warm'], columns: [2, 1, 0, 3] },
    { startWord: 'stone', words: ['store', 'shore', 'share', 'spare'], columns: [3, 1, 2, 1] },
  ])('underlines each accepted change from $startWord, matching the example', ({ startWord, words, columns }) => {
    const view = render(<WordLadderBoard ladder={{ startWord, targetWords: 4 }} steps={words.map(guess => ({ guess }))} guess="" finished busy={false}/>);
    expect(screen.getByRole('row', { name: startWord }).querySelector('.underlined')).toBeNull();
    words.forEach((word, row) => {
      const cells = within(screen.getByRole('row', { name: word })).getAllByRole('gridcell');
      expect(cells.filter(cell => cell.classList.contains('underlined'))).toEqual([cells[columns[row]!]]);
      expect(cells[columns[row]!]).toHaveAccessibleName(`${word[columns[row]!]}, Changed letter`);
    });
    view.rerender(<WordLadderBoard ladder={{ startWord, targetWords: 4 }} steps={[{ guess: words[0]! }]} guess={words[1]!} finished={false} busy={false}/>);
    expect(screen.getByRole('row', { name: 'Next word' }).querySelector('.underlined')).toBeNull();
  });

  it('uses the same rejection feedback for repeated words', async () => {
    localStorage.setItem('lexiplay-last-game', game.id);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/auth/me')) return new Response('{}', { status: 401 });
      if (path.endsWith('/games/wallet')) return Response.json({ coinBalance: 9, kind: 'guest' });
      if (path.endsWith('/games/ladder')) return Response.json(game);
      if (path.endsWith('/guesses')) return Response.json({ code: 'REPEATED_LADDER_WORD', message: 'Use a different word. The starting word and earlier words cannot be reused.' }, { status: 400 });
      return Response.json([]);
    }));
    const user = userEvent.setup(); render(<App/>);
    await screen.findByRole('row', { name: 'Next word' });
    await user.keyboard('cold');
    expect(await screen.findByText('Use a different word. The starting word and earlier words cannot be reused.')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: 'Next word' })).toHaveClass('invalid-guess');
    expect(screen.getByText('0 / 4 words')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose a new puzzle' })).toBeEnabled();
  });

  it.each(['word-puzzle', 'word-ladder'])('gives up %s and displays the revealed answer without a refund notice', async kind => {
    localStorage.setItem('lexiplay-last-game', game.id);
    const active = { ...game, kind, ...(kind === 'word-puzzle' ? { ladder: undefined, attemptLimit: 6 } : {}) };
    let givenUp = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/auth/me')) return new Response('{}', { status: 401 });
      if (path.endsWith('/games/wallet')) return Response.json({ coinBalance: 9, kind: 'guest' });
      if (path.endsWith('/games/ladder')) return Response.json(active);
      if (path.endsWith('/give-up')) {
        givenUp = true;
        return Response.json({ ...active, completed: true, status: 'lost', answer: 'warm', answerDefinition: 'At a comfortable temperature.' });
      }
      return Response.json([]);
    }));
    const user = userEvent.setup(); render(<App/>);
    await user.click(await screen.findByRole('button', { name: 'Give up' }));
    const reminder = await screen.findByRole('dialog', { name: 'Keep your progress.' });
    await user.click(within(reminder).getByRole('button', { name: 'Continue as guest' }));
    expect(await screen.findByText('You gave up. The entry coin was not returned.')).toBeInTheDocument();
    expect(givenUp).toBe(true);
    expect(!!screen.queryByText('THE ANSWER')).toBe(kind === 'word-puzzle');
    expect(screen.getByLabelText('Coin balance: 9')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Give up' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play again' })).toBeInTheDocument();
  });

  it('restores the completed ladder and replays the same game type and length', async () => {
    localStorage.setItem('lexiplay-last-game', game.id);
    const starts: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/auth/me')) return new Response('{}', { status: 401 });
      if (path.endsWith('/games/wallet')) return Response.json({ coinBalance: 14, kind: 'guest' });
      if (path.endsWith('/games/ladder')) return Response.json({ ...game, completed: true, status: 'won', attemptCount: 4, guesses: ['cord','card','ward','warm'].map(guess => ({ guess, definition: `Definition of ${guess}.`, feedback: [], completed: guess === 'warm' })) });
      if (path.endsWith('/games') && init?.method === 'POST') { starts.push(JSON.parse(String(init.body))); return Response.json(game); }
      return Response.json([]);
    }));
    const user = userEvent.setup(); render(<App/>);
    expect(await screen.findByText('4 new words made.')).toBeInTheDocument();
    const play = screen.getByRole('button', { name: 'Play again' });
    await waitFor(() => expect(play).toBeEnabled());
    await user.click(play);
    expect(starts[0]).toMatchObject({ kind: 'word-ladder', wordLength: 4 });
    expect(await screen.findByRole('row', { name: 'Next word' })).toBeInTheDocument();
  });
});
