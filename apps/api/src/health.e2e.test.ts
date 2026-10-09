import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';

describe('health HTTP endpoint', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
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

  it('accepts two randomly selected vocabulary guesses at lengths three through six', async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
    const baseUrl = `${await app.getUrl()}/api/v1`;
    const vocabularyPath = resolve(__dirname, '../../../packages/shared/vocabulary');

    for (const wordLength of [3, 4, 5, 6]) {
      const words = readFileSync(resolve(vocabularyPath, `allowed-guesses-${wordLength}.txt`), 'utf8')
        .trim().split(/\r?\n/);
      const randomWords = new Set<string>();
      while (randomWords.size < 2) randomWords.add(words[randomInt(words.length)]!);

      for (const word of randomWords) {
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
        const result = await guessResponse.json() as { guess: string; feedback: string[] };
        expect(result.guess).toBe(word);
        expect(result.feedback).toHaveLength(wordLength);
      }
    }
  });
});
