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
import { WORDLE_POOL } from './modules/word-lists/wordle-pool';
import { WordListsService } from './modules/word-lists/word-lists.service';
import { WordListRepository } from './modules/word-lists/word-list.repository';
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
    vi.spyOn(WordListsService.prototype, 'dictionarySynonym').mockResolvedValue('fruit');
    pool = new Pool({ connectionString: database! });
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    url = (await app.getUrl()) + '/api/v1';
  }, 30000);
  beforeEach(async () => {
    await pool.query('TRUNCATE account_users,guest_sessions,vocabulary_collections,dictionary_entries CASCADE');
    await publishDictionary(pool, dictionary);
    appleCollection = (await pool.query(`INSERT INTO vocabulary_collections(slug,name,category)
      VALUES('fixture-apple','Apple practice','Fixture') RETURNING id`)).rows[0].id;
    await pool.query(`INSERT INTO collection_entries(collection_id,dictionary_entry_id,sort_order)
      SELECT $1,e.id,0 FROM dictionary_entries e WHERE e.term='apple' ON CONFLICT DO NOTHING`, [appleCollection]);

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
      WHERE u.user_id=$1 AND e.term=$2 ORDER BY e.part_of_speech`, [user.id, term])).rows[0];
  }

  it('counts distinct playable words by length and excludes names while preserving ordinary homographs', async () => {
    await publishDictionary(pool, [...dictionary, word('Paris'), word('Alice'), word('sally', ['proper noun']), word('China'), word('china')]);
    await pool.query(`INSERT INTO collection_entries(collection_id,dictionary_entry_id,sort_order)
      SELECT $1,id,1 FROM dictionary_entries WHERE term IN ('cover','Paris','Alice','sally','China','china') ON CONFLICT DO NOTHING`, [appleCollection]);
    const options = await (await request('/collections/game-options?wordLength=5')).json();
    expect(options.totalWords).toBe(5);
    expect(options.collections.find((row: { id: string }) => row.id === appleCollection)).toMatchObject({ wordCount: 3 });
    const longer = await (await request('/collections/game-options?wordLength=6')).json();
    expect(longer.collections.find((row: { id: string }) => row.id === appleCollection)).toMatchObject({ wordCount: 0 });
    const allResponse = await request('/collections/game-options/all');
    expect(allResponse.status).toBe(200);
    const all = await allResponse.json();
    expect(all.map((row: { wordLength: number }) => row.wordLength)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(all.find((row: { wordLength: number }) => row.wordLength === 5)).toEqual(options);
    expect(all.find((row: { wordLength: number }) => row.wordLength === 6)).toEqual(longer);
    expect((await request('/collections/game-options?wordLength=10')).status).toBe(400);
    const user = await account();
    const started = await start(user.cookie);
    const saved = (await pool.query('SELECT answer FROM practice_games WHERE id=$1', [started.id])).rows[0];
    expect(['apple','cover','china']).toContain(saved.answer);
  });

  it('matches single-word guess validation to the full pool, excluding proper nouns and missing English definitions', async () => {
    await publishDictionary(pool, [...dictionary, word('paris', ['proper noun']), word('alone')]);
    await pool.query("UPDATE dictionary_definitions SET language_code='fr' WHERE dictionary_entry_id IN (SELECT id FROM dictionary_entries WHERE term='alone')");
    const repository = app.get(WordListRepository);
    const allowed = new Set(await repository.dictionaryGameWords(5));
    for (const term of ['apple', 'cover', 'paper', 'paris', 'alone', 'zzzzz']) {
      expect(await repository.isDictionaryGameWord(term), term).toBe(allowed.has(term));
    }
    expect(allowed.has('apple')).toBe(true);
    expect(['paris', 'alone', 'zzzzz'].some(term => allowed.has(term))).toBe(false);
    const snapshotResponse = await request('/word-lists/dictionary/game-words?wordLength=5');
    expect(snapshotResponse.status).toBe(200);
    const snapshot = await snapshotResponse.json();
    const revision = await (await request('/library/revision')).json();
    expect(snapshot).toEqual({ version: revision.version, wordLength: 5, words: [...allowed] });
    for (const length of ['2', '10', 'five', '5.5', '']) {
      expect((await request('/word-lists/dictionary/game-words?wordLength=' + length)).status).toBe(400);
    }
  });

  it('plays Original Wordle from a hidden, dictionary-backed collection', async () => {
    expect(new Set(WORDLE_POOL.words).size).toBe(2315);
    expect(WORDLE_POOL.words.every(term => /^[a-z]{5}$/.test(term))).toBe(true);
    const hidden = (await pool.query("SELECT id FROM vocabulary_collections WHERE slug='wordle-original' AND hidden")).rows[0];
    expect(hidden).toBeDefined();
    const catalog = await (await request('/collections')).json();
    expect(catalog.some((row: { id: string }) => row.id === hidden.id)).toBe(false);
    expect(await (await request('/collections/categories')).json()).not.toContain('Games');
    const options = await (await request('/collections/game-options?wordLength=5')).json();
    expect(options.collections.some((row: { id: string }) => row.id === hidden.id)).toBe(false);
    for (const suffix of ['', '/words', '/snapshot']) {
      expect((await request('/collections/wordle-original' + suffix)).status).toBe(404);
    }
    const user = await account();
    expect((await request('/collections/wordle-original/save', 'POST', {}, user.cookie)).status).toBe(404);
    for (const body of [{ wordLength: 6 }, { collectionId: appleCollection }, { playWithMyWords: true }]) {
      expect((await request('/games', 'POST', { kind: 'wordle', ...body }, user.cookie)).status).toBe(400);
    }
    expect(await balance(user.cookie)).toBe(100);
    const response = await request('/games', 'POST', { kind: 'wordle', startRequestId: randomUUID() }, user.cookie);
    expect(response.status).toBe(201);
    const game = await response.json();
    expect(game).toMatchObject({ wordLength: 5, pool: { id: hidden.id, name: 'Original Wordle' } });
    expect(game).not.toHaveProperty('answer');
    const stored = (await pool.query('SELECT answer,collection_id FROM practice_games WHERE id=$1', [game.id])).rows[0];
    expect(WORDLE_POOL.words).toContain(stored.answer);
    expect(stored.collection_id).toBe(hidden.id);
    const guess = await request(`/games/${game.id}/guesses`, 'POST', { guess: stored.answer }, user.cookie);
    expect(await guess.json()).toMatchObject({ completed: true, outcome: 'WON' });
  });

  it('uses 14 tables and enforces balances, ownership, and case-preserved identities', async () => {
    const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations'")).rows;
    expect(tables).toHaveLength(14);
    const user = await account();
    expect(user.coinBalance).toBe(100);
    await pool.query('UPDATE account_users SET coin_balance=500 WHERE id=$1', [user.id]);
    expect(await balance(user.cookie)).toBe(500);
    expect(await (await request('/auth/me', 'GET', undefined, user.cookie)).json()).toMatchObject({ coinBalance: 500 });
    await expect(pool.query('UPDATE account_users SET coin_balance=-1 WHERE id=$1', [user.id])).rejects.toMatchObject({ code: '23514' });
    const matches = await (await request('/word-lists/dictionary?q=polish')).json();
    expect(matches.map((row: {term:string}) => row.term)).toEqual(['polish','Polish']);
    expect(await (await request('/word-lists/dictionary/Polish/definition')).json()).toEqual({ definition: 'From Poland.' });
    expect(await (await request('/word-lists/dictionary/polish/definition')).json()).toEqual({ definition: 'To make shiny.' });
    const added = await request('/word-lists/' + user.id + '/dictionary-entries', 'POST', { terms: ['Polish','polish'] }, user.cookie);
    expect(await added.json()).toMatchObject({ added: 2 });
    expect((await pool.query('SELECT count(*)::int n FROM user_words WHERE user_id=$1', [user.id])).rows[0].n).toBe(2);
    expect((await request('/word-lists/' + user.id + '/words/' + randomUUID(), 'PATCH', { definition: 'Edited.' }, user.cookie)).status).toBe(404);
    const metadata = (await pool.query(`SELECT e.source_metadata FROM dictionary_entries e WHERE e.term='apple'`)).rows[0].source_metadata;
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
    expect(first).not.toHaveProperty('answer'); expect(first).not.toHaveProperty('answerDefinition'); expect(first).not.toHaveProperty('allowedWords'); expect(first).not.toHaveProperty('owner');
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
    expect((await pool.query('SELECT active_state,attempt_count,coin_change FROM practice_games WHERE id=$1',[first.id])).rows[0]).toEqual({active_state:null,attempt_count:1,coin_change:Number(reward)-1});
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
    const previous = await start(user.cookie);
    await expect(app.get(GameService).start(5, ['apple'], 'easy', 'user:' + user.id, { id: randomUUID(), name: 'Missing collection', author: '' })).rejects.toThrow();
    expect(await balance(user.cookie)).toBe(99);
    expect((await pool.query('SELECT status FROM practice_games WHERE id=$1',[previous.id])).rows[0].status).toBe('active');
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
    expect((await request('/games/' + game.id + '/hints', 'POST', { type: 'definition' }, cookie)).status).toBe(201);
    await request('/progress/claim', 'POST', { accountId: user.id, transferId: randomUUID(), words: [], lastGameId: game.id }, user.cookie + '; ' + cookie);
    const next = dictionary.filter(row => row.term !== 'apple');
    await pool.query("DELETE FROM collection_entries WHERE dictionary_entry_id IN (SELECT id FROM dictionary_entries WHERE term='apple')");
    expect((await publishDictionary(pool, next)).cancelled).toBe(1);
    expect((await publishDictionary(pool, next)).cancelled).toBe(0);
    const cancelled = await (await request('/games/' + game.id, 'GET', undefined, user.cookie)).json();
    expect(cancelled).toMatchObject({ status: 'cancelled', completed: true });
    expect(await balance(user.cookie)).toBe(100);
    expect((await pool.query('SELECT coin_balance FROM guest_sessions WHERE token_hash=$1', [guestOwner(cookie)!.slice(6)])).rows[0].coin_balance).toBe(9);
    expect(await (await request('/progress/summary', 'GET', undefined, user.cookie)).json()).toMatchObject({ total: 0, wins: 0, losses: 0 });
    expect((await request('/games/' + game.id + '/guesses', 'POST', { guess: 'paper' }, user.cookie)).status).toBe(400);
  });

  it('refunds a game when its answer becomes a capitalized-only dictionary entry', async () => {
    const user = await account(), game = await start(user.cookie);
    const next = dictionary.map(row => row.term === 'apple' ? word('Apple') : row);
    await pool.query("DELETE FROM collection_entries WHERE dictionary_entry_id IN (SELECT id FROM dictionary_entries WHERE term='apple')");
    expect((await publishDictionary(pool, next)).cancelled).toBe(1);
    expect(await balance(user.cookie)).toBe(100);
    const resumed = await (await request('/games/' + game.id, 'GET', undefined, user.cookie)).json();
    expect(resumed.status).toBe('cancelled');
    const won = await request('/games/' + game.id + '/guesses', 'POST', { guess: 'apple' }, user.cookie);
    expect(won.status).toBe(400);
    expect(await balance(user.cookie)).toBe(100);
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
    await publishDictionary(pool, [...dictionary, word(incoming.term, incoming.partsOfSpeech)]);
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
    const ids = (await pool.query("SELECT e.id FROM dictionary_entries e WHERE e.term='cover' ORDER BY e.part_of_speech")).rows.map(row => row.id);
    for (const slug of ['overlap-one','overlap-two']) {
      const collection = (await pool.query("INSERT INTO vocabulary_collections(slug,name,category) VALUES($1,$1,'Fixture') RETURNING id", [slug + user.id])).rows[0].id;
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
    await publishDictionary(pool, updated);
    const after = await (await request('/collections/cefr-a1')).json();
    expect(after.version).not.toBe(before.version);
    await pool.query('UPDATE library_state SET version=gen_random_uuid() WHERE id=1');
    const regrouped = await (await request('/collections/cefr-a1')).json();
    expect(regrouped.version).not.toBe(after.version);
    const history = await (await request('/games/' + game.id, 'GET', undefined, user.cookie)).json();
    expect(history).toMatchObject({answer:'apple',answerDefinition:'Updated meaning.',attemptCount:1,coinChange:3,guesses:[]});
    expect(await balance(user.cookie)).toBe(103);
    const stats = await (await request('/progress/summary', 'GET', undefined, user.cookie)).json();
    expect(stats).toMatchObject({ total: 1, wins: 1, losses: 0 });
    const columns = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='practice_guesses'")).rows.map(row => row.column_name);
    expect(columns).toEqual([]);
  });

  it('paginates recent practice without changing overall statistics or exposing other accounts', async () => {
    const user = await account(), other = await account();
    for (let index = 0; index < 3; index++) {
      const game = await start(user.cookie);
      await request(`/games/${game.id}/guesses`, 'POST', { guess: 'apple' }, user.cookie);
    }
    const foreign = await start(other.cookie);
    await request(`/games/${foreign.id}/guesses`, 'POST', { guess: 'apple' }, other.cookie);
    const first = await (await request('/progress/summary?page=1&pageSize=2', 'GET', undefined, user.cookie)).json();
    const second = await (await request('/progress/summary?page=2&pageSize=2', 'GET', undefined, user.cookie)).json();
    expect(first).toMatchObject({ total: 3, wins: 3, page: 1, pageSize: 2, totalPages: 2 });
    expect(second).toMatchObject({ total: 3, wins: 3, page: 2, totalPages: 2 });
    expect(first.recent).toHaveLength(2);
    expect(second.recent).toHaveLength(1);
    expect(new Set([...first.recent, ...second.recent].map(game => game.id)).size).toBe(3);
    expect([...first.recent, ...second.recent].some(game => game.id === foreign.id)).toBe(false);
    expect(first.recent[0]).toMatchObject({ answer: 'apple', answerDefinition: 'Definition of apple.' });
    const clamped = await (await request('/progress/summary?page=99&pageSize=2', 'GET', undefined, user.cookie)).json();
    expect(clamped.page).toBe(2);
    for (const query of ['page=0', 'page=abc', 'pageSize=51', 'pageSize=0']) {
      expect((await request('/progress/summary?' + query, 'GET', undefined, user.cookie)).status).toBe(400);
    }
  });
  it('persists only active inputs, resumes scoring, and clears state after completion', async () => {
    const user=await account(),game=await start(user.cookie);
    await request('/games/'+game.id+'/guesses','POST',{guess:'paper'},user.cookie);
    await request('/games/'+game.id+'/hints','POST',{type:'definition'},user.cookie);
    const row=(await pool.query('SELECT active_state FROM practice_games WHERE id=$1',[game.id])).rows[0];
    expect(row.active_state.guesses).toEqual(['paper']);
    expect(row.active_state.hints.definition).toBe(0);
    expect(row.active_state).not.toHaveProperty('feedback');
    const resumed=await (await request('/games/'+game.id,'GET',undefined,user.cookie)).json();
    expect(resumed.guesses[0]).toMatchObject({guess:'paper',attemptsRemaining:5});
    await request('/games/'+game.id+'/guesses','POST',{guess:'apple'},user.cookie);
    expect((await pool.query('SELECT active_state,attempt_count FROM practice_games WHERE id=$1',[game.id])).rows[0]).toEqual({active_state:null,attempt_count:2});
  });

  it('charges each hint once under concurrent requests and restores purchased clues', async () => {
    const user = await account(), game = await start(user.cookie);
    const hint = (type: string) => request('/games/' + game.id + '/hints', 'POST', { type }, user.cookie);
    const replies = await Promise.all([hint('definition'), hint('definition')]);
    expect(replies.map(response => response.status)).toEqual([201, 201]);
    const clues = await Promise.all(replies.map(response => response.json()));
    expect(clues.map(clue => clue.cost).sort()).toEqual([0, 1]);
    expect(await balance(user.cookie)).toBe(98);
    expect(await (await hint('synonym')).json()).toMatchObject({ text: 'fruit', cost: 1 });
    expect(await balance(user.cookie)).toBe(97);
    const restored = await (await request('/games/' + game.id, 'GET', undefined, user.cookie)).json();
    expect(restored).toMatchObject({ hints: { synonym: 0, definition: 0 }, clues: { synonym: 'fruit', definition: 'Definition of _____.' }, hintCoinsSpent: 2 });
    expect(restored).not.toHaveProperty('answer');
    await request('/games/' + game.id + '/abandon', 'POST', {}, user.cookie);
    expect(await balance(user.cookie)).toBe(98);
    expect((await pool.query('SELECT coin_change FROM practice_games WHERE id=$1', [game.id])).rows[0].coin_change).toBe(-2);
  });

  it('does not charge for unavailable hints or commit a hint without enough coins', async () => {
    const user = await account(), game = await start(user.cookie);
    vi.mocked(WordListsService.prototype.dictionarySynonym).mockResolvedValueOnce(undefined);
    const path = '/games/' + game.id + '/hints';
    const unavailable = await request(path, 'POST', { type: 'synonym' }, user.cookie);
    expect(unavailable.status).toBe(400);
    expect(await balance(user.cookie)).toBe(99);
    await pool.query('UPDATE account_users SET coin_balance=0 WHERE id=$1', [user.id]);
    const denied = await request(path, 'POST', { type: 'definition' }, user.cookie);
    expect(denied.status).toBe(400);
    expect(await denied.json()).toMatchObject({ code: 'INSUFFICIENT_COINS' });
    expect(await balance(user.cookie)).toBe(0);
    const restored = await (await request('/games/' + game.id, 'GET', undefined, user.cookie)).json();
    expect(restored).toMatchObject({ hints: { synonym: 1, definition: 1 }, clues: {}, hintCoinsSpent: 0 });
    const other = await account();
    expect((await request(path, 'POST', { type: 'definition' }, other.cookie)).status).toBe(404);
    expect(await balance(other.cookie)).toBe(100);
  });

  it('keeps hint fees when replacing a puzzle and upgrades saved letter hints', async () => {
    const cookie = await guest(), first = await start(cookie);
    await pool.query("UPDATE practice_games SET active_state=jsonb_set(active_state,'{hints}','{\"unused\":2,\"present\":1}'::jsonb) WHERE id=$1", [first.id]);
    expect((await request('/games/' + first.id + '/hints', 'POST', { type: 'definition' }, cookie)).status).toBe(201);
    expect(await balance(cookie)).toBe(8);
    const second = await start(cookie);
    expect(await balance(cookie)).toBe(8);
    await request('/games/' + second.id + '/abandon', 'POST', {}, cookie);
    expect(await balance(cookie)).toBe(9);
  });

  it('refunds abandonment once and replaces unfinished games without another net debit', async () => {
    const user=await account(),first=await start(user.cookie);
    expect(await balance(user.cookie)).toBe(99);
    const second=await start(user.cookie);
    expect(await balance(user.cookie)).toBe(99);
    expect((await pool.query('SELECT status,coin_change,active_state FROM practice_games WHERE id=$1',[first.id])).rows[0]).toEqual({status:'cancelled',coin_change:0,active_state:null});
    const responses=await Promise.all([request('/games/'+second.id+'/abandon','POST',{},user.cookie),request('/games/'+second.id+'/abandon','POST',{},user.cookie)]);
    expect(responses.every(response=>response.status===201)).toBe(true);
    expect(await balance(user.cookie)).toBe(100);
    expect(await (await request('/progress/summary','GET',undefined,user.cookie)).json()).toMatchObject({total:0,wins:0,losses:0});
  });

  it('refunds the guest wallet when a transferred unfinished game is replaced', async () => {
    const cookie=await guest(),game=await start(cookie),user=await account();
    await request('/progress/claim','POST',{accountId:user.id,transferId:randomUUID(),words:[],lastGameId:game.id},user.cookie+'; '+cookie);
    await start(user.cookie);
    expect(await balance(user.cookie)).toBe(99);
    expect((await pool.query('SELECT coin_balance FROM guest_sessions WHERE token_hash=$1',[guestOwner(cookie)!.slice(6)])).rows[0].coin_balance).toBe(10);
  });

  it('reports unresolved dictionary references without deleting personal words or collections', async () => {
    const user=await account();
    await request('/collections/'+appleCollection+'/save','POST',{},user.cookie);
    const version=(await pool.query('SELECT version FROM library_state')).rows[0].version;
    await expect(publishDictionary(pool,dictionary.filter(word=>word.term!=='apple'))).rejects.toThrow('unresolved references');
    expect(await entry(user,'apple')).toBeTruthy();
    expect((await pool.query('SELECT version FROM library_state')).rows[0].version).toBe(version);
  });

  it('keeps non-English meanings separate while the existing product uses English', async () => {
    await pool.query(`INSERT INTO dictionary_definitions(dictionary_entry_id,language_code,sense_order,definition)
      SELECT id,'fr',0,'Une pomme.' FROM dictionary_entries WHERE term='apple'`);
    expect(await (await request('/word-lists/dictionary/apple/definition')).json()).toEqual({definition:'Definition of apple.'});
    await publishDictionary(pool,dictionary);
    expect((await pool.query("SELECT definition FROM dictionary_definitions WHERE language_code='fr'")).rows[0].definition).toBe('Une pomme.');
  });

});
