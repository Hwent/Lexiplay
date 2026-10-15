import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountController } from './account.controller';
import { AccountRepository, AccountRecord, AccountUser } from './account.repository';
import { AccountService } from './account.service';
import { AccountMailService } from './account-mail.service';

class MemoryAccountRepository {
  private users = new Map<string, AccountRecord>();
  private sessions = new Map<string, string>();
  actions = new Map<string, { userId: string; purpose: string; expiresAt: Date }>();

  async createUser(email: string | null, passwordHash: string, username: string): Promise<AccountUser | null> {
    if ([...this.users.values()].some(user => (email && user.email === email) || user.username === username)) return null;
    const user = { id: `user-${this.users.size + 1}`, email, passwordHash, username, emailVerified: false, coinBalance: 100 };
    this.users.set(user.id, user);
    return { id: user.id, email, username, emailVerified: false, coinBalance: 100 };
  }
  async findUser(identifier: string) { return [...this.users.values()].find(user => user.email === identifier || user.username === identifier) ?? null; }
  async createSession(userId: string, tokenHash: string) { this.sessions.set(tokenHash, userId); }
  async findSession(tokenHash: string) {
    const id = this.sessions.get(tokenHash);
    const user = [...this.users.values()].find(candidate => candidate.id === id);
    return user ? { id: user.id, email: user.email, username: user.username, emailVerified: user.emailVerified, coinBalance: user.coinBalance } : null;
  }
  async deleteSession(tokenHash: string) { this.sessions.delete(tokenHash); }
  async createAction(userId: string, tokenHash: string, purpose: string, expiresAt: Date) {
    for (const [key, action] of this.actions) if (action.userId === userId && action.purpose === purpose) this.actions.delete(key);
    this.actions.set(tokenHash, { userId, purpose, expiresAt });
  }
  async consumeAction(tokenHash: string, purpose: string, passwordHash?: string) {
    const action = this.actions.get(tokenHash);
    if (!action || action.purpose !== purpose || action.expiresAt <= new Date()) return false;
    const user = [...this.users.values()].find(user => user.id === action.userId)!;
    if (purpose === 'verify') user.emailVerified = true;
    else { user.passwordHash = passwordHash!; for (const [key, id] of this.sessions) if (id === user.id) this.sessions.delete(key); }
    this.actions.delete(tokenHash); return true;
  }
}

describe('account HTTP endpoints', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('registers, identifies, signs out, and signs in through the session cookie', async () => {
    const repository = new MemoryAccountRepository();
    @Module({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }])],
      controllers: [AccountController],
      providers: [AccountService, { provide: AccountRepository, useValue: repository }, { provide: AccountMailService, useValue: { send: async () => undefined } }],
    })
    class AccountHttpTestModule {}

    app = await NestFactory.create(AccountHttpTestModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new (await import('@nestjs/common')).ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const baseUrl = `${await app.getUrl()}/api/v1/auth`;
    const email = `learner-${Date.now()}@example.test`;
    const credentials = { email, username: 'learner', password: 'wordpractice123' };

    const registration = await fetch(`${baseUrl}/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials),
    });
    expect(registration.status).toBe(201);
    expect(await registration.json()).toMatchObject({ user: { email } });
    const originalCookie = registration.headers.get('set-cookie');
    expect(originalCookie).toContain('HttpOnly');
    const cookie = originalCookie?.split(';')[0]!;

    const current = await fetch(`${baseUrl}/me`, { headers: { cookie } });
    expect(current.status).toBe(200);
    expect(await current.json()).toEqual({ id: 'user-1', email, username: 'learner', emailVerified: false, coinBalance: 100 });

    const signOut = await fetch(`${baseUrl}/logout`, { method: 'POST', headers: { cookie } });
    expect(signOut.status).toBe(204);
    expect(signOut.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await fetch(`${baseUrl}/me`, { headers: { cookie } })).status).toBe(401);

    const login = await fetch(`${baseUrl}/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: 'learner', password: credentials.password }),
    });
    expect(login.status).toBe(201);
    const loginCookie = login.headers.get('set-cookie')?.split(';')[0]!;
    expect(await (await fetch(`${baseUrl}/me`, { headers: { cookie: loginCookie } })).json()).toEqual({ id: 'user-1', email, username: 'learner', emailVerified: false, coinBalance: 100 });

    let finalResponse: Response | undefined;
    for (let request = 0; request < 8; request += 1) {
      finalResponse = await fetch(`${baseUrl}/me`);
    }
    expect(finalResponse?.status).toBe(429);
  });

  it('allows multiple username-only accounts and sends verification only when requested', async () => {
    const repository = new MemoryAccountRepository();
    const sent: string[] = [];
    @Module({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }])], controllers: [AccountController],
      providers: [AccountService, { provide: AccountRepository, useValue: repository }, { provide: AccountMailService, useValue: { send: async (email: string) => { sent.push(email); } } }],
    }) class OptionalEmailTestModule {}
    app = await NestFactory.create(OptionalEmailTestModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new (await import('@nestjs/common')).ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const url = `${await app.getUrl()}/api/v1/auth`;
    const register = (body: object) => fetch(`${url}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    for (const username of ['learner_one', 'learner_two']) {
      const response = await register({ username, password: 'password8' });
      expect(response.status).toBe(201); expect(await response.json()).toMatchObject({ user: { username, email: null, emailVerified: false, coinBalance: 100 }, verificationSent: false });
    }
    const noVerification = await register({ username: 'learner_three', password: 'password8', email: 'unverified@example.test' });
    expect(noVerification.status).toBe(201); expect(sent).toHaveLength(0);
    const optIn = await register({ username: 'learner_four', password: 'password8', email: 'verified@example.test', sendVerification: true });
    expect(optIn.status).toBe(201); expect(await optIn.json()).toMatchObject({ verificationSent: true }); expect(sent).toEqual(['verified@example.test']);
    expect((await register({ username: 'learner_five', password: 'password8', sendVerification: true })).status).toBe(400);
    expect((await register({ username: 'learner_five', password: 'password8', email: 'invalid' })).status).toBe(400);
    const login = await fetch(`${url}/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: 'learner_one', password: 'password8' }) });
    expect(login.status).toBe(201);
  });
});
