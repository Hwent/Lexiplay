import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Feedback = 'CORRECT' | 'PRESENT' | 'ABSENT';
type WordLength = 3 | 4 | 5 | 6 | 7 | 8;
type Guess = { guess: string; feedback: Feedback[]; attemptsRemaining: number; completed: boolean; outcome?: 'WON' | 'LOST'; answer?: string };
type Game = { id: string; answer: string; wordLength: WordLength; attemptLimit: number; guesses: Guess[]; completed: boolean };

const WORD_LENGTHS = [3, 4, 5, 6, 7, 8] as const;
const vocabularyPath = resolve(__dirname, '../../../../../packages/shared/vocabulary');
const readWords = (file: string) => new Set(
  readFileSync(resolve(vocabularyPath, file), 'utf8').trim().split(/\r?\n/),
);
const GUESSES = new Map(WORD_LENGTHS.map(length => [length, readWords(`allowed-guesses-${length}.txt`)]));
const ANSWERS = new Map(WORD_LENGTHS.map(length => [length, [...readWords(`answers-${length}.txt`)]]));

@Injectable()
export class GameService {
  private readonly games = new Map<string, Game>();
  start(requestedWordLength: unknown = 5, wordList?: string[]) {
    if (typeof requestedWordLength !== 'number' || !WORD_LENGTHS.includes(requestedWordLength as typeof WORD_LENGTHS[number])) {
      throw new BadRequestException({ code: 'INVALID_WORD_LENGTH', message: 'Choose a word length from three to eight letters.' });
    }
    const wordLength = requestedWordLength as WordLength;
    const answerWords = wordList ?? ANSWERS.get(wordLength)!;
    if (!answerWords.length) throw new BadRequestException({ code: 'NO_PLAYABLE_WORDS', message: `Your word list has no ${wordLength}-letter words yet.` });
    const id = randomUUID();
    const answer = answerWords[randomInt(answerWords.length)]!;
    this.games.set(id, { id, answer, wordLength, attemptLimit: 6, guesses: [], completed: false });
    return { id, wordLength, attemptLimit: 6, guesses: [] };
  }

  submit(gameId: string, rawGuess: unknown): Guess {
    const game = this.games.get(gameId);
    if (!game) throw new NotFoundException({ code: 'GAME_NOT_FOUND', message: 'This practice game could not be found.' });
    if (game.completed) throw new BadRequestException({ code: 'GAME_FINISHED', message: 'This game is already complete.' });

    const guess = typeof rawGuess === 'string' ? rawGuess.trim().toLowerCase() : '';
    const allowedGuesses = GUESSES.get(game.wordLength)!;
    const allowedAnswers = new Set(ANSWERS.get(game.wordLength)!);
    if (!/^[a-z]+$/.test(guess) || guess.length !== game.wordLength || (!allowedGuesses.has(guess) && !allowedAnswers.has(guess))) {
      throw new BadRequestException({ code: 'INVALID_GUESS', message: `Enter a valid ${game.wordLength}-letter word from the practice dictionary.` });
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
