import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';

const database = process.env.TEST_DATABASE_URL;
describe.skipIf(!database)('feedback persistence and HTTP validation', () => {
  let pool: Pool;
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let url: string;
  beforeAll(() => {
    if (!new URL(database!).pathname.startsWith('/lexiplay_test_')) throw new Error('Disposable test database required.');
    pool = new Pool({ connectionString: database });
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE account_users,guest_sessions CASCADE');
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    url = (await app.getUrl()) + '/api/v1';
  });
  afterEach(async () => { await app?.close(); });
  afterAll(async () => { await pool?.end(); });
  const post = (body: unknown, cookie = '', path = '/feedback') => fetch(url + path, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body),
  });
  const cookieOf = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!;
  async function register() {
    const response = await post({ username: 'feedback_user', password: 'password8' }, '', '/auth/register');
    expect(response.status).toBe(201);
    return { cookie: cookieOf(response), user: (await response.json()).user };
  }

  it('creates a first-time guest, stores trimmed feedback, and reuses the guest session', async () => {
    const response = await post({ content: '  More vocabulary games, please.  ' });
    expect(response.status).toBe(201);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Lax; Path=/api/v1');
    const result = await response.json();
    expect(Object.keys(result).sort()).toEqual(['createdAt', 'id']);
    const message = (await pool.query('SELECT * FROM message WHERE id=$1', [result.id])).rows[0];
    expect(message.content).toBe('More vocabulary games, please.');
    expect(message.user_id).toBeNull();
    expect(message.guest_session_id).toBeTruthy();
    expect(new Date(result.createdAt).toISOString()).toBe(message.created_at.toISOString());
    const again = await post({ content: 'A second suggestion.' }, cookieOf(response));
    expect(again.status).toBe(201);
    expect(again.headers.get('set-cookie')).toBeNull();
    const messages = (await pool.query('SELECT guest_session_id FROM message')).rows;
    expect(messages).toHaveLength(2);
    expect(new Set(messages.map(row => row.guest_session_id)).size).toBe(1);
  });

  it.each(['expired', 'claimed'])('replaces an %s guest session without changing old messages', async state => {
    const first = await post({ content: 'First message.' });
    const old = (await pool.query('SELECT guest_session_id FROM message')).rows[0].guest_session_id;
    if (state === 'expired') await pool.query("UPDATE guest_sessions SET created_at=now()-interval '31 days',expires_at=now()-interval '1 day' WHERE id=$1", [old]);
    else {
      const { user } = await register();
      await pool.query('UPDATE guest_sessions SET claimed_at=now(),claimed_by_user_id=$2 WHERE id=$1', [old, user.id]);
    }
    const next = await post({ content: 'New session message.' }, cookieOf(first));
    expect(next.status).toBe(201);
    expect(next.headers.get('set-cookie')).toBeTruthy();
    const messages = (await pool.query('SELECT guest_session_id FROM message')).rows;
    expect(new Set(messages.map(row => row.guest_session_id)).size).toBe(2);
    expect(messages.some(row => row.guest_session_id === old)).toBe(true);
  });

  it('attributes signed-in feedback to the account even with a guest cookie', async () => {
    const guest = await post({ content: 'Guest message.' });
    const { cookie, user } = await register();
    const response = await post({ content: 'Signed-in message.' }, cookie + '; ' + cookieOf(guest));
    expect(response.status).toBe(201);
    const row = (await pool.query('SELECT * FROM message WHERE id=$1', [(await response.json()).id])).rows[0];
    expect(row.user_id).toBe(user.id);
    expect(row.guest_session_id).toBeNull();
  });

  it('rejects empty, oversized, non-string content and caller-supplied identity', async () => {
    for (const body of [{ content: ' \n\t ' }, { content: 'a'.repeat(2001) }, { content: 42 }, { content: 'Hi', userId: crypto.randomUUID() }]) {
      expect((await post(body)).status).toBe(400);
    }
    expect((await pool.query('SELECT count(*)::int AS count FROM message')).rows[0].count).toBe(0);
    await expect(pool.query("INSERT INTO message(content) VALUES('No sender')")).rejects.toMatchObject({ code: '23514' });
  });

  it('limits repeated submissions and keeps messages private', async () => {
    const first = await post({ content: 'A suggestion.' });
    const cookie = cookieOf(first);
    for (let index = 0; index < 4; index++) expect((await post({ content: 'Another suggestion.' }, cookie)).status).toBe(201);
    expect((await post({ content: 'Too many.' }, cookie)).status).toBe(429);
    expect((await fetch(url + '/feedback')).status).toBe(404);
  });
});
