import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from './app.module';
import { GameRepository } from './modules/games/game.repository';
import { GameService } from './modules/games/game.service';
import { WordListRepository } from './modules/word-lists/word-list.repository';
import { AccountRepository } from './modules/accounts/account.repository';
import { AccountMailService } from './modules/accounts/account-mail.service';
import { AccountService } from './modules/accounts/account.service';
import { createHash, randomBytes } from 'node:crypto';

const testUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!testUrl)('real PostgreSQL persistence', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
  let mail: { purpose: string; token: string }[];
  beforeEach(() => {
    if (!new URL(testUrl!).pathname.startsWith('/lexiplay_test_')) throw new Error('Use a disposable lexiplay_test_* database.');
    vi.stubEnv('DATABASE_URL', testUrl!);
    mail = [];
    vi.spyOn(AccountMailService.prototype, 'send').mockImplementation(async (_email, purpose, token) => { mail.push({ purpose, token }); });
    vi.spyOn(WordListRepository.prototype, 'dictionaryGameWords').mockResolvedValue(['apple', 'paper']);
    vi.spyOn(WordListRepository.prototype, 'getDictionaryDefinition').mockImplementation(async term => `Definition of ${term}.`);
  });
  afterEach(async () => { await app?.close(); app = undefined; vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  async function boot() {
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1'); return `${await app.getUrl()}/api/v1`;
  }
  it('survives API restart, serializes concurrent guesses, rejects another owner, and reports saved Statistics', async () => {
    let url = await boot();
    const accounts = app!.get(AccountService);
    const user = await accounts.register({ username: `test_${randomBytes(5).toString('hex')}`, email: `${randomBytes(5).toString('hex')}@example.test`, password: 'password8' });
    const owner = `user:${user.user.id}`;
    const games = app!.get(GameService);
    const started = await games.start(5, ['apple'], 'easy', owner);
    await games.hint(started.id, 'unused', owner);
    await Promise.all([games.submit(started.id, 'paper', owner), games.submit(started.id, 'paper', owner), games.submit(started.id, 'paper', owner)]);
    await expect(games.read(started.id, 'user:someone-else')).rejects.toThrow();
    await app!.close(); app = undefined;
    url = await boot();
    const restored = await app!.get(GameService).read(started.id, owner);
    expect(restored).not.toHaveProperty('answer'); expect(restored).not.toHaveProperty('allowedWords');
    expect(restored.guesses).toHaveLength(3); expect(restored.hints.unused).toBe(2); expect(restored.revealedAbsent).toHaveLength(3);
    await app!.get(GameService).submit(started.id, 'apple', owner);
    const pool = new Pool({ connectionString: testUrl });
    try { expect((await pool.query('SELECT position FROM practice_guesses WHERE game_id = $1 ORDER BY position', [started.id])).rows.map(row => row.position)).toEqual([0, 1, 2, 3]); } finally { await pool.end(); }
    const summary = await fetch(`${url}/progress/summary?timezone=America%2FToronto`, { headers: { cookie: `lexiplay_session=${user.token}` } });
    expect(summary.status).toBe(200);
    expect(await summary.json()).toMatchObject({ total: 1, wins: 1, streak: 1, recent: [{ id: started.id, guesses: [{ guess: 'paper' }, { guess: 'paper' }, { guess: 'paper' }, { guess: 'apple' }] }] });
    expect((await fetch(`${url}/progress/summary`)).status).toBe(401);
    expect((await fetch(`${url}/progress/summary?timezone=bad`, { headers: { cookie: `lexiplay_session=${user.token}` } })).status).toBe(400);
    expect((await app!.get(GameRepository).history('user:someone-else')).length).toBe(0);
  });
  it('verifies email and resets passwords once, expires links, and revokes existing sessions', async () => {
    const url = await boot();
    const account = app!.get(AccountService);
    const email = `${randomBytes(5).toString('hex')}@example.test`;
    const username = `test_${randomBytes(5).toString('hex')}`;
    const registered = await account.register({ email, username, password: 'password8' });
    expect(registered.verificationSent).toBe(true);
    await account.verifyEmail(mail[0]!.token);
    await expect(account.verifyEmail(mail[0]!.token)).rejects.toThrow('invalid or expired');
    expect((await account.current(registered.token)).emailVerified).toBe(true);
    const headers = { 'content-type': 'application/json' };
    expect((await fetch(`${url}/auth/register`, { method: 'POST', headers, body: JSON.stringify({ email: 'other@example.test', username, password: 'password8' }) })).status).toBe(409);
    expect((await fetch(`${url}/auth/register`, { method: 'POST', headers, body: JSON.stringify({ email: 'new@example.test', username: 'new_user', password: 'short' }) })).status).toBe(400);
    const known = await account.requestReset(email); const unknown = await account.requestReset('unknown@example.test'); expect(unknown).toEqual(known);
    const replaced = mail.find(item => item.purpose === 'reset')!.token;
    await account.requestReset(email);
    await expect(account.resetPassword(replaced, 'password9')).rejects.toThrow('invalid or expired');
    const reset = mail.filter(item => item.purpose === 'reset').at(-1)!.token;
    const result = await fetch(`${url}/auth/reset-password`, { method: 'POST', headers, body: JSON.stringify({ token: reset, password: 'newpass8' }) });
    expect(result.status).toBe(201);
    await expect(account.current(registered.token)).rejects.toThrow();
    await expect(account.resetPassword(reset, 'password9')).rejects.toThrow('invalid or expired');
    await expect(account.login({ identifier: username, password: 'password8' })).rejects.toThrow('incorrect');
    expect((await account.login({ identifier: username.toUpperCase(), password: 'newpass8' })).user.email).toBe(email);
    expect((await account.login({ identifier: email, password: 'newpass8' })).user.username).toBe(username);
    const expired = randomBytes(32).toString('base64url');
    await app!.get(AccountRepository).createAction(registered.user.id, createHash('sha256').update(expired).digest('hex'), 'reset', new Date(Date.now() - 60_000));
    await expect(account.resetPassword(expired, 'password9')).rejects.toThrow('invalid or expired');
  });
});
