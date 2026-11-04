import 'reflect-metadata';
import { ValidationPipe, NotFoundException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from './app.module';
import { WordListRepository } from './modules/word-lists/word-list.repository';
import { WordListsService } from './modules/word-lists/word-lists.service';
import { GameService, score } from './modules/games/game.service';
import { GameRepository } from './modules/games/game.repository';
import { Game } from './modules/games/game.types';
import { statistics } from './modules/games/statistics.controller';

describe('game HTTP endpoints and rules', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
  let stored: Map<string, Game>;
  beforeEach(() => {
    stored = new Map();
    vi.spyOn(GameRepository.prototype, 'create').mockImplementation(async game => { stored.set(game.id, structuredClone(game)); return game; });
    vi.spyOn(GameRepository.prototype, 'read').mockImplementation(async (id, owner) => {
      const game = stored.get(id);
      if (!game || game.owner !== owner) throw new NotFoundException();
      return structuredClone(game);
    });
    vi.spyOn(GameRepository.prototype, 'change').mockImplementation(async (id, owner, operation) => {
      const game = await app!.get(GameRepository).read(id, owner);
      const result = await operation(game);
      stored.set(id, structuredClone(game));
      return result;
    });
    vi.spyOn(WordListRepository.prototype, 'getDictionaryDefinition').mockImplementation(async term => `Definition of ${term}.`);
    vi.spyOn(WordListRepository.prototype, 'isDictionaryGameWord').mockResolvedValue(false);
  });
  afterEach(async () => { await app?.close(); app = undefined; vi.restoreAllMocks(); });
  async function startApp() {
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    return `${await app.getUrl()}/api/v1`;
  }
  it('returns a healthy versioned public route', async () => {
    const url = await startApp();
    expect(await (await fetch(`${url}/health`)).json()).toEqual({ status: 'ok' });
  });
  it('accepts every length from 3–9 through the production validation pipeline and protects saved games', async () => {
    const words = ['cat', 'book', 'apple', 'orange', 'because', 'elephant', 'beautiful'];
    vi.mocked(WordListRepository.prototype.isDictionaryGameWord).mockImplementation(async term => words.includes(term));
    vi.spyOn(WordListRepository.prototype, 'dictionaryGameWords').mockImplementation(async length => words.filter(word => word.length === length));
    const url = await startApp();
    const rewards: Record<number, number> = { 3: 4, 4: 4, 5: 5, 6: 5, 7: 6, 8: 6, 9: 7 };
    for (const word of words) {
      const response = await fetch(`${url}/games`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wordLength: word.length }) });
      expect(response.status).toBe(201);
      const game = await response.json();
      expect(game).toMatchObject({ difficulty: 'medium', attemptLimit: 6, winRewardCoins: rewards[word.length] });
      const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
      expect(game).not.toHaveProperty('answer'); expect(game).not.toHaveProperty('owner'); expect(game).not.toHaveProperty('allowedWords');
      expect((await fetch(`${url}/games/${game.id}`)).status).toBe(404);
      const headers = { 'content-type': 'application/json', cookie };
      const invalid = await fetch(`${url}/games/${game.id}/guesses`, { method: 'POST', headers, body: JSON.stringify({ guess: 'zz' }) });
      expect(invalid.status).toBe(400);
      const guess = await fetch(`${url}/games/${game.id}/guesses`, { method: 'POST', headers, body: JSON.stringify({ guess: ` ${word.toUpperCase()} ` }) });
      expect(guess.status, `length ${word.length}: ${await guess.clone().text()}`).toBe(201);
      expect(await guess.json()).toMatchObject({ guess: word, completed: true, outcome: 'WON', answer: word, answerDefinition: `Definition of ${word}.`, rewardCoins: rewards[word.length] });
      const restored = await (await fetch(`${url}/games/${game.id}`, { headers })).json();
      expect(restored.guesses).toHaveLength(1);
      expect(restored.guesses[0].definition).toBe(`Definition of ${word}.`);
    }
    expect(WordListRepository.prototype.getDictionaryDefinition).toHaveBeenCalledTimes(words.length);
    for (const body of [{ wordLength: 10 }, { difficulty: 'impossible' }, { vocabularyRange: 'cefr-z9' }, { wordLength: '5' }, { playWithMyWords: 'true' }, { answer: 'apple' }]) {
      expect((await fetch(`${url}/games`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(400);
    }
  });

  it('uses dictionary-backed personal words', async () => {
    vi.spyOn(WordListRepository.prototype, 'dictionaryGameWords').mockResolvedValue(['apple', 'lucid', 'scope']);
    await startApp();
    const games = app!.get(GameService);
    const game = await games.start(5, ['lucid', 'lucid', 'zzzzz'], 'medium', 'test');
    expect(stored.get(game.id)!.answer).toBe('lucid');
    expect(game).not.toHaveProperty('vocabularyRange');
    await expect(games.start(5, ['zzzzz'], 'medium', 'test')).rejects.toThrow('Your word list has no');
    await expect(games.start(5, [], 'medium', 'test')).rejects.toThrow('Your word list has no');
    const unrestricted = await games.start(5, undefined, 'medium', 'test');
    expect(['apple', 'lucid', 'scope']).toContain(stored.get(unrestricted.id)!.answer);
  });
  it('narrows default answers by length while accepting wider dictionary guesses and custom sources', async () => {
    vi.mocked(WordListRepository.prototype.isDictionaryGameWord).mockImplementation(async term => ['apple', 'xylyl', 'cat', 'qat'].includes(term));
    const dictionary = vi.spyOn(WordListRepository.prototype, 'dictionaryGameWords').mockResolvedValue(['apple', 'xylyl']);
    await startApp(); const games = app!.get(GameService);
    const classic = await games.start(5, undefined, 'medium', 'test');
    expect(stored.get(classic.id)!.answer).toBe('apple');
    expect(await games.submit(classic.id, 'xylyl', 'test')).toMatchObject({ completed: false, attemptsRemaining: 5 });
    const personal = await games.start(5, ['xylyl'], 'medium', 'test');
    expect(stored.get(personal.id)!.answer).toBe('xylyl');
    dictionary.mockResolvedValue(['cat', 'qat']);
    const short = await games.start(3, undefined, 'medium', 'test');
    expect(stored.get(short.id)!.answer).toBe('cat');
    expect(await games.submit(short.id, 'qat', 'test')).toMatchObject({ completed: false, attemptsRemaining: 5 });
    dictionary.mockResolvedValue(['xylyl']);
    await expect(games.start(5, undefined, 'medium', 'test')).rejects.toThrow('No 5-letter answers');
  });
  it('checks individual words without reloading the dictionary pool or consuming invalid guesses', async () => {
    vi.mocked(WordListRepository.prototype.isDictionaryGameWord).mockImplementation(async term => ['apple', 'paper'].includes(term));
    const dictionary = vi.spyOn(WordListRepository.prototype, 'dictionaryGameWords').mockResolvedValue(['apple', 'paper']);
    await startApp(); const games = app!.get(GameService);
    const game = await games.start(5, ['apple'], 'medium', 'test');
    await expect(games.submit(game.id, 'zzzzz', 'test')).rejects.toThrow('Enter a valid');
    await expect(games.submit(game.id, 'cat', 'test')).rejects.toThrow('Enter a valid');
    dictionary.mockResolvedValue(['apple', 'paper']);
    expect((await games.submit(game.id, 'paper', 'test')).attemptsRemaining).toBe(5);
    expect(await games.submit(game.id, ' APPLE ', 'test')).toMatchObject({ answer: 'apple', outcome: 'WON' });
    expect(dictionary).toHaveBeenCalledOnce();
    expect(WordListRepository.prototype.getDictionaryDefinition).toHaveBeenCalledTimes(2);
    await expect(games.start(5, ['zzzzz'], 'medium', 'test')).rejects.toThrow('in the game dictionary');
    dictionary.mockResolvedValue(['apple']);
    vi.mocked(WordListRepository.prototype.getDictionaryDefinition).mockResolvedValue('');
    const withoutDefinition = await games.start(5, undefined, 'medium', 'test');
    expect(await games.submit(withoutDefinition.id, 'apple', 'test')).toMatchObject({ outcome: 'WON', definition: '', answerDefinition: '' });
    expect(WordListRepository.prototype.getDictionaryDefinition).toHaveBeenCalledTimes(3);
    dictionary.mockResolvedValue([]);
    await expect(games.start(5, undefined, 'medium', 'test')).rejects.toThrow('Load the dictionary');
  });
  it.each(['easy', 'medium', 'hard'] as const)('normalizes %s starts to six guesses and offers a definition hint', async difficulty => {
    const attempts = 6;
    vi.mocked(WordListRepository.prototype.isDictionaryGameWord).mockImplementation(async term => ['apple', 'paper'].includes(term));
    vi.spyOn(WordListRepository.prototype, 'dictionaryGameWords').mockResolvedValue(['apple', 'paper']);
    await startApp(); const games = app!.get(GameService);
    const game = await games.start(5, ['apple'], difficulty, 'test');
    expect(game).toMatchObject({ difficulty: 'medium', attemptLimit: 6, winRewardCoins: 5 });
    expect(game.hints).toEqual({ definition: 1 });
    expect(await games.hint(game.id, 'definition', 'test')).toMatchObject({ text: 'Definition of _____.', cost: 1 });
    expect(await games.hint(game.id, 'definition', 'test')).toMatchObject({ text: 'Definition of _____.', cost: 0 });
    expect(stored.get(game.id)!.hintCoinsSpent).toBe(1);
    for (let i = 1; i <= attempts; i++) expect(await games.submit(game.id, 'paper', 'test')).toMatchObject({ attemptsRemaining: attempts - i, completed: i === attempts, definition: 'Definition of paper.', ...(i === attempts ? { outcome: 'LOST', answer: 'apple', answerDefinition: 'Definition of apple.' } : {}) });
    expect(WordListRepository.prototype.getDictionaryDefinition).toHaveBeenCalledTimes(attempts + 2);
    await expect(games.hint(game.id, 'definition', 'test')).rejects.toThrow('already complete');
    await expect(games.submit(game.id, 'apple', 'test')).rejects.toThrow('already complete');
  });
  it('validates definition hints through HTTP and rejects removed hints', async () => {
    vi.spyOn(WordListRepository.prototype, 'dictionaryGameWords').mockResolvedValue(['apple']);
    const url = await startApp();
    const response = await fetch(`${url}/games`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wordLength: 5 }) });
    const game = await response.json();
    const headers = { 'content-type': 'application/json', cookie: response.headers.get('set-cookie')!.split(';')[0]! };
    const hint = await fetch(`${url}/games/${game.id}/hints`, { method: 'POST', headers, body: JSON.stringify({ type: 'definition' }) });
    expect(hint.status).toBe(201);
    expect(await hint.json()).toMatchObject({ type: 'definition', text: 'Definition of _____.', cost: 1 });
    expect((await fetch(`${url}/games/${game.id}/hints`, { method: 'POST', headers, body: JSON.stringify({ type: 'partOfSpeech' }) })).status).toBe(400);
    expect(await (await fetch(`${url}/games/${game.id}`, { headers })).json()).toMatchObject({ clues: { definition: 'Definition of _____.' }, hintCoinsSpent: 1 });
  });

  it('does not consume a hint when the dictionary has no definition', async () => {
    vi.spyOn(WordListRepository.prototype, 'dictionaryGameWords').mockResolvedValue(['apple']);
    vi.mocked(WordListRepository.prototype.getDictionaryDefinition).mockResolvedValueOnce('');
    await startApp(); const games = app!.get(GameService);
    const game = await games.start(5, ['apple'], 'medium', 'test');
    await expect(games.hint(game.id, 'definition', 'test')).rejects.toThrow('No definition is available');
    expect(await games.read(game.id, 'test')).toMatchObject({ hints: { definition: 1 }, clues: {}, hintCoinsSpent: 0 });
  });

  it('masks the answer in definition hints, including capitals and longer words', async () => {
    vi.spyOn(WordListRepository.prototype, 'dictionaryGameWords').mockResolvedValue(['apple']);
    vi.mocked(WordListRepository.prototype.getDictionaryDefinition).mockResolvedValue('An APPLE, apples, or pineapple; apple-shaped fruit.');
    await startApp();
    const games = app!.get(GameService);
    const game = await games.start(5, ['apple'], 'medium', 'test');
    expect(await games.hint(game.id, 'definition', 'test')).toMatchObject({
      text: 'An _____, _____s, or pine_____; _____-shaped fruit.', cost: 1,
    });
    expect(await games.hint(game.id, 'definition', 'test')).toMatchObject({
      text: 'An _____, _____s, or pine_____; _____-shaped fruit.', cost: 0,
    });
  });
  it('scores duplicate letters without overcounting', () => {
    expect(score('apple', 'paper')).toEqual(['PRESENT', 'PRESENT', 'CORRECT', 'PRESENT', 'ABSENT']);
  });
  it('counts completed practice days in the learner timezone across midnight and DST', () => {
    const games = [
      { completedAt: '2026-03-09T03:30:00Z', guesses: [{ outcome: 'WON' }, {}] },
      { completedAt: '2026-03-08T04:30:00Z', guesses: [{ outcome: 'WON' }] },
      { completedAt: '2026-03-07T04:30:00Z', guesses: [{ outcome: 'LOST' }] },
    ].map((game, i) => ({ id: String(i), ...game, status: i < 2 ? 'won' : 'lost', attemptCount: game.guesses.length })) as Game[];
    expect(statistics(games, 'America/Toronto', new Date('2026-03-09T12:00:00Z'))).toMatchObject({ total: 3, wins: 2, losses: 1, winRate: 67, streak: 3 });
    expect(statistics([], 'UTC')).toMatchObject({ total: 0, winRate: 0, streak: 0 });
  });
});
