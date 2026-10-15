import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from './app.module';
import { AccountMailService } from './modules/accounts/account-mail.service';
import { GameService } from './modules/games/game.service';
import { guestOwner } from './modules/games/guest-cookie';
import { CEFR_POOLS } from './modules/word-lists/cefr-pools';
import { publishDictionary, type LibraryWord } from './modules/word-lists/library-maintenance';

const database = process.env.TEST_DATABASE_URL;
const word = (term: string, positions = ['noun']): LibraryWord => ({
  term, definition: 'Definition of ' + term + '.', part_of_speech: positions,
  senses: positions.map(partOfSpeech => ({ partOfSpeech, definitions: ['Definition of ' + term + '.'], source: 'fixture', synsetIds: [term + '-source'] })),
});
const dictionary: LibraryWord[] = [
  ...['cat','book','apple','orange','because','elephant','beautiful','paper','action','actor','actress'].map(term => word(term)),
  word('cover', ['noun','verb']),
  { ...word('Polish', ['adjective']), senses: [{ partOfSpeech: 'adjective', definitions: ['From Poland.'], source: 'fixture' }] },
  { ...word('polish', ['verb']), senses: [{ partOfSpeech: 'verb', definitions: ['To make shiny.'], source: 'fixture' }] },
];
type Account = { id: string; cookie: string; coinBalance: number };

describe.skipIf(!database)('canonical database, vocabulary, and coin transactions', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>, pool: Pool, url: string, appleCollection: string;
  beforeAll(async () => {
    if (!new URL(database!).pathname.startsWith('/lexiplay_test_')) throw new Error('Disposable test database required.');
    vi.stubEnv('DATABASE_URL', database!);
    vi.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);
    vi.spyOn(AccountMailService.prototype, 'send').mockResolvedValue(undefined);
    pool = new Pool({ connectionString: database! });
    await publishDictionary(pool, dictionary, 'integration-fixture');
    const revision = (await pool.query("SELECT id FROM library_revisions WHERE scope='collections' AND is_current")).rows[0].id;
    appleCollection = (await pool.query(`INSERT INTO vocabulary_collections(slug,name,category,revision_id)
      VALUES('fixture-apple','Apple practice','Fixture',$1)
      ON CONFLICT(slug) DO UPDATE SET revision_id=EXCLUDED.revision_id RETURNING id`, [revision])).rows[0].id;
    await pool.query(`INSERT INTO collection_entries(collection_id,dictionary_entry_id,sort_order)
      SELECT $1,e.id,0 FROM dictionary_entries e JOIN dictionary_words w ON w.id=e.word_id WHERE w.term='apple'
      ON CONFLICT DO NOTHING`, [appleCollection]);
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    url = (await app.getUrl()) + '/api/v1';
  }, 30000);
  beforeEach(async () => {
    await pool.query('TRUNCATE account_users CASCADE');
    await publishDictionary(pool, dictionary, 'integration-fixture');
  });
  afterAll(async () => { await app?.close(); await pool?.end(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  const request = (path: string, method = 'GET', body?: unknown, cookie?: string) =>
    fetch(url + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  async function account(): Promise<Account> {
    const response = await request('/auth/register', 'POST', { username: 'test_' + randomBytes(5).toString('hex'), password: 'password8' });
    expect(response.status).toBe(201);
    const body = await response.json();
    return { id: body.user.id, coinBalance: body.user.coinBalance, cookie: response.headers.get('set-cookie')!.split(';')[0]! };
  }
  async function guest() {
    const response = await request('/games/wallet');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ coinBalance: 10, kind: 'guest' });
    return response.headers.get('set-cookie')!.split(';')[0]!;
  }
  async function start(cookie: string, difficulty = 'medium', startRequestId = randomUUID()) {
    const response = await request('/games', 'POST', { collectionId: appleCollection, wordLength: 5, difficulty, startRequestId }, cookie);
    expect(response.status, await response.clone().text()).toBe(201);
    return response.json();
  }
  async function balance(cookie: string) { return (await (await request('/games/wallet', 'GET', undefined, cookie)).json()).coinBalance; }
  async function entry(user: Account, term: string) {
    return (await pool.query(`SELECT u.* FROM user_words u JOIN dictionary_entries e ON e.id=u.dictionary_entry_id
      JOIN dictionary_words w ON w.id=e.word_id WHERE u.user_id=$1 AND w.term=$2 ORDER BY e.part_of_speech`, [user.id, term])).rows[0];
  }

  it('uses 16 tables and enforces balances, ownership, and case-preserved identities', async () => {
    const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations'")).rows;
    expect(tables).toHaveLength(16);
    const user = await account();
    expect(user.coinBalance).toBe(100);
    await expect(pool.query('UPDATE account_users SET coin_balance=-1 WHERE id=$1', [user.id])).rejects.toMatchObject({ code: '23514' });
    const matches = await (await request('/word-lists/dictionary?q=polish')).json();
    expect(matches.map((row: {term:string}) => row.term)).toEqual(['polish','Polish']);
    expect(await (await request('/word-lists/dictionary/Polish/definition')).json()).toEqual({ definition: 'From Poland.' });
    expect(await (await request('/word-lists/dictionary/polish/definition')).json()).toEqual({ definition: 'To make shiny.' });
    const added = await request('/word-lists/' + user.id + '/dictionary-entries', 'POST', { terms: ['Polish','polish'] }, user.cookie);
    expect(await added.json()).toMatchObject({ added: 2 });
    expect((await pool.query('SELECT count(*)::int n FROM user_words WHERE user_id=$1', [user.id])).rows[0].n).toBe(2);
    expect((await request('/word-lists/' + user.id + '/words/' + randomUUID(), 'PATCH', { definition: 'Edited.' }, user.cookie)).status).toBe(404);
    const metadata = (await pool.query(`SELECT e.source_metadata FROM dictionary_entries e JOIN dictionary_words w ON w.id=e.word_id WHERE w.term='apple'`)).rows[0].source_metadata;
    expect(metadata.groups[0]).toMatchObject({ source: 'fixture', synsetIds: ['apple-source'] });
  });

  it('expires stale account cookies so a reset or expired account does not block guest play', async () => {
    const response = await request('/auth/me', 'GET', undefined, 'lexiplay_session=' + 'a'.repeat(43));
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    const staleWallet = await request('/games/wallet', 'GET', undefined, 'lexiplay_session=' + 'a'.repeat(43));
    expect(staleWallet.status).toBe(200);
    expect(await staleWallet.json()).toMatchObject({ coinBalance: 10, kind: 'guest' });
    const cookie = await guest();
    const game = await start(cookie);
    expect((await request('/games/' + game.id, 'GET', undefined, cookie + '; lexiplay_session=' + 'a'.repeat(43))).status).toBe(200);
    expect(await balance(cookie)).toBe(9);
  });

  it.each([['easy',4],['medium',5],['hard',6]])('charges once and credits a %s win exactly once', async (difficulty, reward) => {
    const user = await account(), id = randomUUID();
    const [first, retry] = await Promise.all([start(user.cookie, difficulty, id), start(user.cookie, difficulty, id)]);
    expect(first.id).toBe(retry.id);
    expect(first).not.toHaveProperty('answer'); expect(first).not.toHaveProperty('allowedWords'); expect(first).not.toHaveProperty('owner');
    expect(await balance(user.cookie)).toBe(99);
    await request('/games/' + first.id, 'GET', undefined, user.cookie);
    expect(await balance(user.cookie)).toBe(99);
    const responses = await Promise.all([
      request('/games/' + first.id + '/guesses', 'POST', { guess: ' APPLE ' }, user.cookie),
      request('/games/' + first.id + '/guesses', 'POST', { guess: 'apple' }, user.cookie),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([201,400]);
    const won = await responses.find(response => response.status === 201)!.json();
    expect(won).toMatchObject({ outcome: 'WON', rewardCoins: reward });
    expect(await balance(user.cookie)).toBe(99 + Number(reward));
    expect((await pool.query('SELECT count(*)::int n FROM practice_guesses WHERE game_id=$1', [first.id])).rows[0].n).toBe(1);
    expect((await pool.query('SELECT reward_credited_at FROM practice_games WHERE id=$1', [first.id])).rows[0].reward_credited_at).toBeTruthy();
  });

  it('leaves losses charged and rejects invalid or unaffordable starts without debit', async () => {
    const user = await account(), game = await start(user.cookie, 'hard');
    for (let i = 0; i < 5; i++) {
      const result = await (await request('/games/' + game.id + '/guesses', 'POST', { guess: 'paper' }, user.cookie)).json();
      expect(result.completed).toBe(i === 4);
      if (i === 4) expect(result.outcome).toBe('LOST');
    }
    expect(await balance(user.cookie)).toBe(99);
    const failed = await request('/games', 'POST', { wordLength: 10 }, user.cookie);
    expect(failed.status).toBe(400); expect(await balance(user.cookie)).toBe(99);
    await pool.query('UPDATE account_users SET coin_balance=0 WHERE id=$1', [user.id]);
    const denied = await request('/games', 'POST', { collectionId: appleCollection, startRequestId: randomUUID() }, user.cookie);
    expect(denied.status).toBe(400); expect(await denied.json()).toMatchObject({ code: 'INSUFFICIENT_COINS' });
    expect(await balance(user.cookie)).toBe(0);
  });

  it('rolls back a debit when game insertion fails later in its transaction', async () => {
    const user = await account();
    await expect(app.get(GameService).start(5, ['apple'], 'easy', 'user:' + user.id, { id: randomUUID(), name: 'Missing collection', author: '' })).rejects.toThrow();
    expect(await balance(user.cookie)).toBe(100);
    expect((await pool.query('SELECT count(*)::int n FROM practice_games')).rows[0].n).toBe(0);
  });

  it('keeps guest payouts in the original wallet after a retry-safe progress transfer', async () => {
    const cookie = await guest(), game = await start(cookie), user = await account(), transferId = randomUUID();
    expect(await balance(cookie)).toBe(9);
    const body = { accountId: user.id, transferId, words: [{ term: 'cover', definition: 'Ignored personal text.', status: 'UNFAMILIAR' }], lastGameId: game.id };
    const combined = user.cookie + '; ' + cookie;
    const claimed = await request('/progress/claim', 'POST', body, combined);
    expect(claimed.status).toBe(201);
    expect(await claimed.json()).toMatchObject({ gamesTransferred: 1, resumeGameId: game.id });
    expect(await balance(user.cookie)).toBe(100);
    const restored = await (await request('/games/' + game.id, 'GET', undefined, user.cookie)).json();
    expect(restored.coinPayer).toBe('guest');
    expect((await request('/games/' + game.id, 'GET', undefined, cookie)).status).toBe(404);
    const won = await (await request('/games/' + game.id + '/guesses', 'POST', { guess: 'apple' }, user.cookie)).json();
    expect(won.rewardCoins).toBe(5);
    const guestCoins = (await pool.query('SELECT coin_balance FROM guest_sessions WHERE token_hash=$1', [guestOwner(cookie)!.slice(6)])).rows[0].coin_balance;
    expect(guestCoins).toBe(14); expect(await balance(user.cookie)).toBe(100);
    expect((await request('/progress/claim', 'POST', body, combined)).status).toBe(201);
    expect(await balance(user.cookie)).toBe(100);
    const other = await account();
    expect((await request('/progress/claim', 'POST', { ...body, accountId: other.id, transferId: randomUUID() }, other.cookie + '; ' + cookie)).status).toBe(409);
  });

  it('cancels unplayable games and refunds the original guest payer once after transfer', async () => {
    const cookie = await guest(), game = await start(cookie), user = await account();
    await request('/progress/claim', 'POST', { accountId: user.id, transferId: randomUUID(), words: [], lastGameId: game.id }, user.cookie + '; ' + cookie);
    const next = dictionary.filter(row => row.term !== 'apple');
    expect((await publishDictionary(pool, next, 'maintenance-fixture')).cancelled).toBe(1);
    expect((await publishDictionary(pool, next, 'maintenance-fixture')).cancelled).toBe(0);
    const cancelled = await (await request('/games/' + game.id, 'GET', undefined, user.cookie)).json();
    expect(cancelled).toMatchObject({ status: 'cancelled', completed: true });
    expect(await balance(user.cookie)).toBe(100);
    expect((await pool.query('SELECT coin_balance FROM guest_sessions WHERE token_hash=$1', [guestOwner(cookie)!.slice(6)])).rows[0].coin_balance).toBe(10);
    expect(await (await request('/progress/summary', 'GET', undefined, user.cookie)).json()).toMatchObject({ total: 0, wins: 0, losses: 0 });
    expect((await request('/games/' + game.id + '/guesses', 'POST', { guess: 'paper' }, user.cookie)).status).toBe(400);
  });

  it('resumes a playable normalized answer when its dictionary case identity changes', async () => {
    const user = await account(), game = await start(user.cookie);
    const next = dictionary.map(row => row.term === 'apple' ? word('Apple') : row);
    expect((await publishDictionary(pool, next, 'case-updated-fixture')).cancelled).toBe(0);
    expect(await balance(user.cookie)).toBe(99);
    const resumed = await (await request('/games/' + game.id, 'GET', undefined, user.cookie)).json();
    expect(resumed.status).toBe('active');
    const won = await request('/games/' + game.id + '/guesses', 'POST', { guess: 'apple' }, user.cookie);
    expect(won.status).toBe(201);
    expect(await won.json()).toMatchObject({ outcome: 'WON', rewardCoins: 5 });
    expect(await balance(user.cookie)).toBe(104);
  });

  it('preserves progress and exclusions through collection saves and automatic renewal', async () => {
    const user = await account();
    await request('/collections/cefr-a1/save', 'POST', {}, user.cookie);
    const before = (await pool.query('SELECT count(*)::int n FROM user_words WHERE user_id=$1', [user.id])).rows[0].n;
    await request('/collections/cefr-a1/save', 'POST', {}, user.cookie);
    expect((await pool.query('SELECT count(*)::int n FROM user_words WHERE user_id=$1', [user.id])).rows[0].n).toBe(before);
    const apple = await entry(user, 'apple');
    await request('/word-lists/' + user.id + '/entries/' + apple.id, 'PATCH', { familiarity: 4 }, user.cookie);
    await request('/word-lists/' + user.id + '/entries/' + apple.id, 'DELETE', undefined, user.cookie);
    const incoming = CEFR_POOLS[0]!.words.find(row => !dictionary.some(existing => existing.term === row.term))!;
    await publishDictionary(pool, [...dictionary, word(incoming.term, incoming.partsOfSpeech)], 'expanded-fixture');
    expect((await entry(user, 'apple'))).toMatchObject({ status: 'excluded', familiarity: 4 });
    expect((await entry(user, incoming.term)).status).toBe('active');
    await request('/collections/cefr-a1/save', 'POST', {}, user.cookie);
    expect((await entry(user, 'apple')).status).toBe('excluded');
    await request('/word-lists/' + user.id + '/dictionary-entries', 'POST', { terms: ['apple'] }, user.cookie);
    expect(await entry(user, 'apple')).toMatchObject({ status: 'active', familiarity: 4 });
    await request('/collections/cefr-a1/save', 'DELETE', undefined, user.cookie);
    expect(await entry(user, 'apple')).toMatchObject({ status: 'active', familiarity: 4 });
    expect(await (await request('/word-lists/collections', 'GET', undefined, user.cookie)).json()).toEqual([]);
  });

  it('deduplicates overlapping collection imports and keeps noun and verb progress independent', async () => {
    const user = await account();
    const ids = (await pool.query("SELECT e.id FROM dictionary_entries e JOIN dictionary_words w ON w.id=e.word_id WHERE w.term='cover' ORDER BY e.part_of_speech")).rows.map(row => row.id);
    const revision = (await pool.query("SELECT id FROM library_revisions WHERE scope='collections' AND is_current")).rows[0].id;
    for (const slug of ['overlap-one','overlap-two']) {
      const collection = (await pool.query("INSERT INTO vocabulary_collections(slug,name,category,revision_id) VALUES($1,$1,'Fixture',$2) RETURNING id", [slug + user.id, revision])).rows[0].id;
      await pool.query('INSERT INTO collection_entries(collection_id,dictionary_entry_id,sort_order) SELECT $1,unnest($2::uuid[]),0', [collection, ids]);
      await request('/collections/' + collection + '/save', 'POST', {}, user.cookie);
    }
    const rows = (await pool.query('SELECT id,familiarity FROM user_words WHERE user_id=$1', [user.id])).rows;
    expect(rows).toHaveLength(2);
    await request('/word-lists/' + user.id + '/entries/' + rows[0].id, 'PATCH', { familiarity: 5 }, user.cookie);
    expect((await pool.query('SELECT familiarity FROM user_words WHERE user_id=$1 ORDER BY familiarity', [user.id])).rows.map(row => row.familiarity)).toEqual([0,5]);
  });

  it('shows newest definitions in completed history and versions cached collections with the dictionary', async () => {
    const user = await account(), game = await start(user.cookie, 'easy');
    await request('/games/' + game.id + '/guesses', 'POST', { guess: 'apple' }, user.cookie);
    const before = await (await request('/collections/cefr-a1')).json();
    const updated = dictionary.map(row => row.term === 'apple' ? { ...row, definition: 'Updated meaning.', senses: [{ partOfSpeech: 'noun', definitions: ['Updated meaning.'], source: 'fixture' }] } : row);
    await publishDictionary(pool, updated, 'updated-definitions');
    const after = await (await request('/collections/cefr-a1')).json();
    expect(after.version).not.toBe(before.version);
    const history = await (await request('/games/' + game.id, 'GET', undefined, user.cookie)).json();
    expect(history.guesses[0]).toMatchObject({ definition: 'Updated meaning.', answerDefinition: 'Updated meaning.' });
    expect(await balance(user.cookie)).toBe(103);
    const stats = await (await request('/progress/summary', 'GET', undefined, user.cookie)).json();
    expect(stats).toMatchObject({ total: 1, wins: 1, losses: 0 });
    const columns = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='practice_guesses'")).rows.map(row => row.column_name);
    expect(columns).not.toContain('definition');
  });
});
