import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountController } from './account.controller';
import { AccountRepository, AccountRecord, AccountUser } from './account.repository';
import { AccountService } from './account.service';

class MemoryAccountRepository {
  private users = new Map<string, AccountRecord>();
  private sessions = new Map<string, string>();

  async createUser(email: string, passwordHash: string): Promise<AccountUser | null> {
    if (this.users.has(email)) return null;
    const user = { id: `user-${this.users.size + 1}`, email, passwordHash };
    this.users.set(email, user);
    return { id: user.id, email };
  }
  async findUser(email: string) { return this.users.get(email) ?? null; }
  async createSession(userId: string, tokenHash: string) { this.sessions.set(tokenHash, userId); }
  async findSession(tokenHash: string) {
    const id = this.sessions.get(tokenHash);
    const user = [...this.users.values()].find(candidate => candidate.id === id);
    return user ? { id: user.id, email: user.email } : null;
  }
  async deleteSession(tokenHash: string) { this.sessions.delete(tokenHash); }
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
      providers: [AccountService, { provide: AccountRepository, useValue: repository }],
    })
    class AccountHttpTestModule {}

    app = await NestFactory.create(AccountHttpTestModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new (await import('@nestjs/common')).ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const baseUrl = `${await app.getUrl()}/api/v1/auth`;
    const email = `learner-${Date.now()}@example.test`;
    const credentials = { email, password: 'wordpractice123' };

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
    expect(await current.json()).toEqual({ id: 'user-1', email });

    const signOut = await fetch(`${baseUrl}/logout`, { method: 'POST', headers: { cookie } });
    expect(signOut.status).toBe(204);
    expect(signOut.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await fetch(`${baseUrl}/me`, { headers: { cookie } })).status).toBe(401);

    const login = await fetch(`${baseUrl}/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials),
    });
    expect(login.status).toBe(201);
    const loginCookie = login.headers.get('set-cookie')?.split(';')[0]!;
    expect(await (await fetch(`${baseUrl}/me`, { headers: { cookie: loginCookie } })).json()).toEqual({ id: 'user-1', email });

    let finalResponse: Response | undefined;
    for (let request = 0; request < 8; request += 1) {
      finalResponse = await fetch(`${baseUrl}/me`);
    }
    expect(finalResponse?.status).toBe(429);
  });
});
