import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

type Feedback = 'CORRECT' | 'PRESENT' | 'ABSENT';
type Guess = { guess: string; feedback: Feedback[]; attemptsRemaining: number; completed: boolean; outcome?: 'WON' | 'LOST'; answer?: string };
type Game = { id: string; answer: string; attemptLimit: number; guesses: Guess[]; completed: boolean };

const WORDS = ['crane', 'slate', 'plant', 'bloom', 'stare', 'raise', 'words'];
const ANSWERS = ['plant', 'crane', 'slate', 'bloom'];

@Injectable()
export class GameService {
  private readonly games = new Map<string, Game>();
  private nextAnswer = 0;

  start() {
    const id = randomUUID();
    const answer = ANSWERS[this.nextAnswer % ANSWERS.length]!;
    this.nextAnswer += 1;
    this.games.set(id, { id, answer, attemptLimit: 6, guesses: [], completed: false });
    return { id, wordLength: 5, attemptLimit: 6, guesses: [] };
  }

  submit(gameId: string, rawGuess: unknown): Guess {
    const game = this.games.get(gameId);
    if (!game) throw new NotFoundException({ code: 'GAME_NOT_FOUND', message: 'This practice game could not be found.' });
    if (game.completed) throw new BadRequestException({ code: 'GAME_FINISHED', message: 'This game is already complete.' });

    const guess = typeof rawGuess === 'string' ? rawGuess.trim().toLowerCase() : '';
    if (!/^[a-z]{5}$/.test(guess) || !WORDS.includes(guess)) {
      throw new BadRequestException({ code: 'INVALID_GUESS', message: 'Enter a valid five-letter word from the practice dictionary.' });
    }

    const feedback = this.score(game.answer, guess);
    const won = guess === game.answer;
    const attemptsRemaining = game.attemptLimit - game.guesses.length - 1;
    const completed = won || attemptsRemaining === 0;
    const result: Guess = { guess, feedback, attemptsRemaining, completed };
    if (completed) {
      result.outcome = won ? 'WON' : 'LOST';
      result.answer = game.answer;
      game.completed = true;
    }
    game.guesses.push(result);
    return result;
  }

  private score(answer: string, guess: string): Feedback[] {
    const feedback: Feedback[] = Array.from({ length: answer.length }, () => 'ABSENT');
    const remaining = new Map<string, number>();
    for (let index = 0; index < answer.length; index += 1) {
      const answerLetter = answer[index]!;
      if (guess[index] === answerLetter) feedback[index] = 'CORRECT';
      else remaining.set(answerLetter, (remaining.get(answerLetter) ?? 0) + 1);
    }
    for (let index = 0; index < guess.length; index += 1) {
      if (feedback[index] === 'CORRECT') continue;
      const letter = guess[index]!;
      const occurrences = remaining.get(letter) ?? 0;
      if (occurrences > 0) {
        feedback[index] = 'PRESENT';
        remaining.set(letter, occurrences - 1);
      }
    }
    return feedback;
  }
}
