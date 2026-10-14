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
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { guestOwner } from './modules/games/guest-cookie';

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
  it('stores definition-free CEFR pools, resolves senses on add, persists subscriptions, and plays from the selected list', async () => {
    let url = await boot();
    const catalogResponse = await fetch(url + '/word-lists/pools');
    expect(catalogResponse.status).toBe(200);
    const catalog = await catalogResponse.json();
    expect(catalog.map((pool: { level: string }) => pool.level)).toEqual(['A1','A2','B1','B2','C1','C2']);
    expect(catalog.filter((pool: { level: string }) => pool.level !== 'C2').every((pool: { author: string }) => pool.author === 'oxford_3000_5000')).toBe(true);
    expect(catalog.find((pool: { level: string }) => pool.level === 'C2')).toMatchObject({id:'lexiplay-c2',author:'LexiPlay; Octanove Labs',wordCount:942,familyCount:731});
    expect((await fetch(url + '/word-lists/pools/oxford-a1', { method: 'POST' })).status).toBe(401);
    await app!.get(WordListRepository).poolDictionaryEntries(['apple']);
    const pool = new Pool({ connectionString: testUrl! });
    try {
      await pool.query(`INSERT INTO dictionary_words(term,definition,part_of_speech,senses) VALUES ('apple','A fruit.',ARRAY['noun'],'[{"partOfSpeech":"noun","definitions":["A fruit."]}]'::jsonb)
        ON CONFLICT(term) DO UPDATE SET senses=EXCLUDED.senses,definition=EXCLUDED.definition`);
      const user = await app!.get(AccountService).register({ username: 'pool_' + randomBytes(5).toString('hex'), password: 'password8' });
      const headers = { cookie: 'lexiplay_session=' + user.token, 'content-type': 'application/json' };
      for (let repeat = 0; repeat < 2; repeat++) {
        const response = await fetch(url + '/word-lists/pools/oxford-a1', { method: 'POST', headers });
        expect(response.status).toBe(201);
        const added = await response.json();
        expect(added.words.find((word: { term: string }) => word.term === 'apple')).toMatchObject({ definition: 'A fruit.', available: true });
      }
      expect(Number((await pool.query('SELECT count(*) FROM user_game_pools WHERE owner_id=$1', [user.user.id])).rows[0].count)).toBe(1);
      const stored = (await pool.query('SELECT author,words FROM game_word_pools')).rows;
      expect(stored).toHaveLength(6);
      for (const row of stored) for (const word of row.words) expect(Object.keys(word).sort()).toEqual(['partsOfSpeech','term']);
      const game = await fetch(url + '/games', { method: 'POST', headers, body: JSON.stringify({ wordLength: 5, poolId: 'oxford-a1' }) });
      expect(game.status).toBe(201);
      expect(await game.json()).toMatchObject({ pool: { id: 'oxford-a1', author: 'oxford_3000_5000' } });
      const empty = await fetch(url + '/games', { method: 'POST', headers, body: JSON.stringify({ wordLength: 7, poolId: 'oxford-a1' }) });
      expect(empty.status).toBe(400);
      await app!.close(); app = undefined; url = await boot();
      expect(await (await fetch(url + '/word-lists/pools/added', { headers })).json()).toEqual([expect.objectContaining({id:'oxford-a1'})]);
    } finally { await pool.end(); }
  });

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
    const registered = await account.register({ email, username, password: 'password8', sendVerification: true });
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
  it('adds optional recovery email and deletes only the authenticated account and all its owned data', async () => {
    const url = await boot(); const accounts = app!.get(AccountService);
    const username = `test_${randomBytes(5).toString('hex')}`;
    const registered = await accounts.register({ username, password: 'password8' });
    const other = await accounts.register({ username: `test_${randomBytes(5).toString('hex')}`, password: 'password8' });
    expect(registered.user).toMatchObject({ email: null, emailVerified: false }); expect(mail).toHaveLength(0);
    const headers = { 'content-type': 'application/json', cookie: `lexiplay_session=${registered.token}` };
    expect((await fetch(`${url}/auth/verification-request`, { method: 'POST', headers })).status).toBe(400);
    const email = `${randomBytes(5).toString('hex')}@example.test`;
    expect((await fetch(`${url}/auth/email`, { method: 'POST', headers, body: JSON.stringify({ email, password: 'wrongpass' }) })).status).toBe(401);
    const added = await fetch(`${url}/auth/email`, { method: 'POST', headers, body: JSON.stringify({ email: ` ${email.toUpperCase()} `, password: 'password8' }) });
    expect(added.status).toBe(201); expect(await added.json()).toMatchObject({ user: { email, emailVerified: false } }); expect(mail).toHaveLength(0);
    expect((await accounts.login({ identifier: email, password: 'password8' })).user.id).toBe(registered.user.id);
    expect((await fetch(`${url}/auth/email`, { method: 'POST', headers, body: JSON.stringify({ email, password: 'password8' }) })).status).toBe(409);
    expect((await fetch(`${url}/auth/verification-request`, { method: 'POST', headers })).status).toBe(201);
    await accounts.requestReset(email); expect(mail.map(item => item.purpose)).toEqual(['verify', 'reset']);
    const lists = app!.get(WordListRepository);
    const ownList = (await lists.findAll(registered.user.id))[0]!; const otherList = (await lists.findAll(other.user.id))[0]!;
    const word = await lists.addWord(registered.user.id, ownList.id, { term: 'apple', definition: 'A fruit.', partOfSpeech: 'noun' });
    await lists.addWord(other.user.id, otherList.id, { term: 'paper', definition: 'Writing material.', partOfSpeech: 'noun' });
    const games = app!.get(GameService); const owner = `user:${registered.user.id}`;
    const game = await games.start(5, ['apple'], 'medium', owner); await games.submit(game.id, 'apple', owner);
    const otherGame = await games.start(5, ['apple'], 'hard', `user:${other.user.id}`);
    expect((await fetch(`${url}/auth/account`, { method: 'DELETE', headers, body: JSON.stringify({ password: 'wrongpass', confirmation: 'DELETE' }) })).status).toBe(401);
    expect((await fetch(`${url}/auth/account`, { method: 'DELETE', headers, body: JSON.stringify({ password: 'password8', confirmation: 'delete' }) })).status).toBe(400);
    expect((await fetch(`${url}/auth/account`, { method: 'DELETE', headers, body: JSON.stringify({ password: 'password8', confirmation: 'DELETE', userId: other.user.id }) })).status).toBe(400);
    expect((await accounts.current(registered.token)).id).toBe(registered.user.id);
    expect((await games.read(game.id, owner)).guesses).toHaveLength(1);
    const deleted = await fetch(`${url}/auth/account`, { method: 'DELETE', headers, body: JSON.stringify({ password: 'password8', confirmation: 'DELETE' }) });
    expect(deleted.status).toBe(204); expect(deleted.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await fetch(`${url}/auth/me`, { headers })).status).toBe(401);
    await expect(accounts.login({ identifier: username, password: 'password8' })).rejects.toThrow('incorrect');
    for (const action of mail) await expect(action.purpose === 'reset' ? accounts.resetPassword(action.token, 'newpass8') : accounts.verifyEmail(action.token)).rejects.toThrow('invalid or expired');
    await expect(games.start(5, ['apple'], 'easy', owner)).rejects.toThrow('account no longer exists');
    const pool = new Pool({ connectionString: testUrl });
    try {
      for (const [table, key, value] of [
        ['account_users', 'id', registered.user.id], ['account_sessions', 'user_id', registered.user.id], ['account_actions', 'user_id', registered.user.id],
        ['guest_progress_claims', 'user_id', registered.user.id], ['progress_transfers', 'user_id', registered.user.id],
        ['user_word_lists', 'owner_id', registered.user.id], ['user_words', 'id', word!.id], ['practice_games', 'owner_key', owner], ['practice_guesses', 'game_id', game.id],
      ]) expect((await pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE ${key} = $1`, [value])).rows[0].count).toBe(0);
    } finally { await pool.end(); }
    expect((await accounts.current(other.token)).id).toBe(other.user.id);
    expect((await lists.find(other.user.id, otherList.id))!.words).toHaveLength(1);
    expect((await games.read(otherGame.id, `user:${other.user.id}`)).id).toBe(otherGame.id);
  });
  it.each(['login', 'register'] as const)('transfers guest games and words after %s, resumes puzzles, and makes retries safe', async mode => {
    let url = await boot(); const accounts = app!.get(AccountService); let games = app!.get(GameService);
    const cookie = `lexiplay_guest=${randomBytes(32).toString('base64url')}`; const guest = guestOwner(cookie)!;
    const completed = await games.start(5, ['apple'], 'easy', guest); await games.submit(completed.id, 'apple', guest);
    const active = await games.start(5, ['apple'], 'medium', guest); await games.submit(active.id, 'paper', guest); await games.hint(active.id, 'present', guest);
    const unrelatedGuest = `guest:${randomBytes(32).toString('hex')}`; const untouched = await games.start(5, ['apple'], 'hard', unrelatedGuest);
    const username = `test_${randomBytes(5).toString('hex')}`;
    const existing = mode === 'login' ? await accounts.register({ username, password: 'password8' }) : undefined;
    let existingWord: { id: string } | null = null;
    if (existing) {
      const lists = app!.get(WordListRepository); const list = (await lists.findAll(existing.user.id))[0]!;
      existingWord = await lists.addWord(existing.user.id, list.id, { term: 'apple', definition: 'My existing definition.', partOfSpeech: 'noun' });
    }
    const auth = await fetch(`${url}/auth/${mode}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(mode === 'login' ? { identifier: username, password: 'password8' } : { username, password: 'password8' }) });
    expect(auth.status).toBe(201); const user = (await auth.json()).user as { id: string };
    const sessionCookie = auth.headers.get('set-cookie')!.split(';')[0]!;
    const headers = { 'content-type': 'application/json', cookie: `${sessionCookie}; ${cookie}` };
    const body = { accountId: user.id, transferId: randomUUID(), lastGameId: active.id, words: [
      { term: 'APPLE', definition: 'A new definition.', status: 'KNOWN', partOfSpeech: 'noun' },
      { term: 'chair', definition: 'A seat.', status: 'KNOWN' },
    ] };
    const claim = () => fetch(`${url}/progress/claim`, { method: 'POST', headers, body: JSON.stringify(body) });
    expect((await fetch(`${url}/progress/claim`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) })).status).toBe(401);
    expect((await fetch(`${url}/progress/claim`, { method: 'POST', headers, body: JSON.stringify({ ...body, accountId: randomUUID() }) })).status).toBe(403);
    expect((await fetch(`${url}/progress/claim`, { method: 'POST', headers, body: JSON.stringify({ ...body, words: [{ term: 'chair', status: 'INVALID' }] }) })).status).toBe(400);
    const [first, retry] = await Promise.all([claim(), claim()]); expect(first.status).toBe(201); expect(retry.status).toBe(201);
    const result = await first.json(); expect(await retry.json()).toEqual(result);
    expect(result).toEqual({ wordsAdded: existing ? 1 : 2, wordsAlreadySaved: existing ? 1 : 0, gamesTransferred: 2, resumeGameId: active.id });
    expect(first.headers.get('set-cookie')).toContain('lexiplay_guest=;'); expect(first.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await fetch(`${url}/progress/claim`, { method: 'POST', headers, body: JSON.stringify({ ...body, words: [{ term: 'changed', status: 'KNOWN' }] }) })).status).toBe(409);
    const another = await accounts.register({ username: `test_${randomBytes(5).toString('hex')}`, password: 'password8' });
    for (const transferId of [body.transferId, randomUUID()]) expect((await fetch(`${url}/progress/claim`, { method: 'POST', headers: { ...headers, cookie: `lexiplay_session=${another.token}; ${cookie}` }, body: JSON.stringify({ ...body, accountId: another.user.id, transferId }) })).status).toBe(409);
    await expect(games.read(active.id, guest)).rejects.toThrow();
    await expect(games.start(5, ['apple'], 'easy', guest)).rejects.toThrow('guest session changed');
    expect((await games.read(untouched.id, unrelatedGuest)).id).toBe(untouched.id);
    await app!.close(); app = undefined; url = await boot(); games = app!.get(GameService);
    const restored = await app!.get(GameRepository).read(active.id, `user:${user.id}`);
    expect(restored.owner).toBe(`user:${user.id}`); expect(restored.guesses).toHaveLength(1); expect(restored.hints.present).toBe(1); expect(restored.revealedPresent).toHaveLength(1);
    const savedWords = (await app!.get(WordListRepository).findAll(user.id))[0]!.words;
    expect(savedWords).toHaveLength(2); expect(savedWords.find(word => word.term === 'chair')!.status).toBe('KNOWN');
    expect(savedWords.find(word => word.term === 'apple')).toMatchObject(existing ? { id: existingWord!.id, definition: 'My existing definition.', status: 'UNFAMILIAR' } : { definition: 'A new definition.', status: 'KNOWN' });
    const summary = await fetch(`${url}/progress/summary`, { headers: { cookie: sessionCookie } }); expect(await summary.json()).toMatchObject({ total: 1, wins: 1 });
    if (mode === 'register') {
      expect((await fetch(`${url}/auth/account`, { method: 'DELETE', headers: { 'content-type': 'application/json', cookie: sessionCookie }, body: JSON.stringify({ password: 'password8', confirmation: 'DELETE' }) })).status).toBe(204);
      const pool = new Pool({ connectionString: testUrl });
      try { for (const table of ['guest_progress_claims', 'progress_transfers']) expect((await pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE user_id = $1`, [user.id])).rows[0].count).toBe(0); } finally { await pool.end(); }
    }
  });
  it('rolls back both words and game ownership when a transfer fails', async () => {
    const url = await boot(); const accounts = app!.get(AccountService);
    const user = await accounts.register({ username: `test_${randomBytes(5).toString('hex')}`, password: 'password8' });
    const cookie = `lexiplay_guest=${randomBytes(32).toString('base64url')}`; const guest = guestOwner(cookie)!;
    const game = await app!.get(GameService).start(5, ['apple'], 'easy', guest);
    const body = { accountId: user.user.id, transferId: randomUUID(), words: [{ term: 'chair', status: 'KNOWN' }] };
    const headers = { 'content-type': 'application/json', cookie: `lexiplay_session=${user.token}; ${cookie}` };
    const failure = vi.spyOn(app!.get(GameRepository), 'transferGuestGames').mockRejectedValueOnce(new Error('Test-only write failure'));
    const first = await fetch(`${url}/progress/claim`, { method: 'POST', headers, body: JSON.stringify(body) }); expect(first.status).toBe(500);
    expect(first.headers.get('set-cookie')).toBeNull(); expect((await app!.get(GameService).read(game.id, guest)).id).toBe(game.id);
    expect((await app!.get(WordListRepository).findAll(user.user.id))[0]!.words).toHaveLength(0);
    const pool = new Pool({ connectionString: testUrl });
    try {
      expect((await pool.query('SELECT count(*)::int AS count FROM progress_transfers WHERE id = $1', [body.transferId])).rows[0].count).toBe(0);
      expect((await pool.query('SELECT count(*)::int AS count FROM guest_progress_claims WHERE guest_owner = $1', [guest])).rows[0].count).toBe(0);
    } finally { await pool.end(); }
    failure.mockRestore();
    const retry = await fetch(`${url}/progress/claim`, { method: 'POST', headers, body: JSON.stringify(body) }); expect(retry.status).toBe(201); expect(await retry.json()).toMatchObject({ wordsAdded: 1, gamesTransferred: 1 });
  });
});
