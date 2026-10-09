import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from './app.module';
import { WordListRepository } from './modules/word-lists/word-list.repository';
import { GameService } from './modules/games/game.service';

describe('health HTTP endpoint', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    vi.restoreAllMocks();
  });

  it('returns an OK status through the versioned public route', async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') throw new Error('The health endpoint did not bind a TCP port.');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('uses the database dictionary for answers, guesses, and definitions at every supported length', async () => {
    const words = ['cat', 'book', 'apple', 'orange', 'because', 'elephant'];
    const dictionary = vi.spyOn(WordListRepository.prototype, 'dictionaryGameWords')
      .mockImplementation(async length => words.filter(word => word.length === length));
    vi.spyOn(WordListRepository.prototype, 'getDictionaryDefinition')
      .mockImplementation(async term => `Definition of ${term}.`);
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
    const baseUrl = `${await app.getUrl()}/api/v1`;
    for (const word of words) {
      const wordLength = word.length;
      const startResponse = await fetch(`${baseUrl}/games`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wordLength }),
      });
      expect(startResponse.status).toBe(201);
      const game = await startResponse.json() as { id: string; wordLength: number };
      expect(game.wordLength).toBe(wordLength);

      const guessResponse = await fetch(`${baseUrl}/games/${game.id}/guesses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ guess: word }),
      });
      expect(guessResponse.status, `length ${wordLength}, guess ${word}: ${await guessResponse.clone().text()}`).toBe(201);
      expect(await guessResponse.json()).toMatchObject({
        guess: word, feedback: Array(wordLength).fill('CORRECT'), completed: true, outcome: 'WON',
        answer: word, definition: `Definition of ${word}.`, answerDefinition: `Definition of ${word}.`,
      });
      expect(dictionary).toHaveBeenCalledWith(wordLength);
    }
  });

  it('restricts personal answers to dictionary words and keeps each game pool stable', async () => {
    const dictionary = vi.spyOn(WordListRepository.prototype, 'dictionaryGameWords').mockResolvedValue(['apple', 'paper']);
    app = await NestFactory.create(AppModule, { logger: false });
    const games = app.get(GameService);
    const game = await games.start(5, ['zzzzz', 'apple', 'apple']);
    expect(game).not.toHaveProperty('answer');
    expect(() => games.submit(game.id, 'zzzzz')).toThrow('Enter a valid');
    dictionary.mockResolvedValue(['other']);
    expect(games.submit(game.id, 'paper').completed).toBe(false);
    expect(games.submit(game.id, ' APPLE ')).toMatchObject({ answer: 'apple', outcome: 'WON' });
    await expect(games.start(5, ['apple'])).rejects.toThrow('in the game dictionary');
    dictionary.mockResolvedValue([]);
    await expect(games.start(5)).rejects.toThrow('Load the dictionary');
    await expect(games.start(2)).rejects.toThrow('three to eight');
  });

  it('retains hints and the six-attempt loss rule with database words', async () => {
    vi.spyOn(WordListRepository.prototype, 'dictionaryGameWords').mockResolvedValue(['apple', 'paper']);
    app = await NestFactory.create(AppModule, { logger: false });
    const games = app.get(GameService);
    const game = await games.start(5, ['apple']);
    const absent = games.hint(game.id, 'unused');
    expect(absent.letters).toHaveLength(3);
    expect(absent.letters?.every(letter => !'apple'.includes(letter))).toBe(true);
    const present = games.hint(game.id, 'present');
    expect('apple').toContain(present.letter);
    for (let attempt = 1; attempt <= 6; attempt++) {
      expect(games.submit(game.id, 'paper')).toMatchObject({ attemptsRemaining: 6 - attempt, completed: attempt === 6 });
    }
    expect(() => games.hint(game.id, 'present')).toThrow('already complete');
    expect(() => games.submit(game.id, 'apple')).toThrow('already complete');
  });
});
