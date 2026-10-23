import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
import { planInflections, applyInflections } from './modules/word-lists/inflection-import';
import { definitionInflections } from './modules/word-lists/dictionary-inflections';

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
  it('discovers a guest active game from its cookie after the application restarts', async () => {
    const cookie = await guest();
    const otherGuest = await guest();
    const game = await start(cookie);
    expect((await request(`/games/${game.id}/guesses`, 'POST', { guess: 'paper' }, cookie)).status).toBe(201);
    await app.close();
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    url = (await app.getUrl()) + '/api/v1';
    expect(await (await request('/games/wallet', 'GET', undefined, cookie)).json()).toMatchObject({ activeGameId: game.id, coinBalance: 9 });
    expect(await (await request('/games/wallet', 'GET', undefined, otherGuest)).json()).toMatchObject({ activeGameId: null, coinBalance: 10 });
    const restored = await (await request(`/games/${game.id}`, 'GET', undefined, cookie)).json();
    expect(restored.guesses).toHaveLength(1);
    expect((await request(`/games/${game.id}`, 'GET', undefined, otherGuest)).status).toBe(404);
    expect((await request(`/games/${game.id}/give-up`, 'POST', {}, cookie)).status).toBe(201);
    expect(await (await request('/games/wallet', 'GET', undefined, cookie)).json()).toMatchObject({ activeGameId: null, coinBalance: 9 });
    await start(cookie);
    expect(await balance(cookie)).toBe(8);
  });
  async function entry(user: Account, term: string) {
    return (await pool.query(`SELECT u.* FROM user_words u JOIN dictionary_entries e ON e.id=u.dictionary_entry_id
      WHERE u.user_id=$1 AND e.term=$2 ORDER BY e.part_of_speech`, [user.id, term])).rows[0];
  }

  it('publishes the top 20 coin balances with server-masked names and shared ranks', async () => {
    expect(await (await request('/community/coin-rankings')).json()).toEqual([]);
    await pool.query(`INSERT INTO account_users(username,password_hash,coin_balance) VALUES
      ('alice','fixture-only',320),('bob','fixture-only',250),('charlie','fixture-only',250);
      INSERT INTO account_users(username,password_hash,coin_balance)
      SELECT 'ranked_' || n,'fixture-only',100-n FROM generate_series(1,20) n`);
    const response = await request('/community/coin-rankings');
    expect(response.status).toBe(200);
    const rankings = await response.json();
    expect(rankings).toHaveLength(20);
    expect(rankings[0]).toEqual({ rank: 1, username: 'al**', coinBalance: 320 });
    expect(rankings.slice(1,3)).toEqual(expect.arrayContaining([
      { rank: 2, username: 'bo**', coinBalance: 250 },
      { rank: 2, username: 'ch**', coinBalance: 250 },
    ]));
    expect(rankings[3]).toEqual({ rank: 4, username: 'ra**', coinBalance: 99 });
    for (const row of rankings) {
      expect(Object.keys(row).sort()).toEqual(['coinBalance','rank','username']);
      expect(row.username).toMatch(/^[a-z]{1,2}\*{2}$/);
      expect(typeof row.coinBalance).toBe('number');
    }
    await pool.query("UPDATE account_users SET coin_balance=500 WHERE username='bob'");
    expect((await (await request('/community/coin-rankings')).json())[0]).toEqual({ rank: 1, username: 'bo**', coinBalance: 500 });
  });

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

  it('loads the dictionary pool only once per collection start and replay', async () => {
    const user = await account();
    const words = vi.spyOn(app.get(WordListRepository), 'dictionaryGameWords');
    try {
      await start(user.cookie);
      expect(words).toHaveBeenCalledTimes(1);
      await start(user.cookie);
      expect(words).toHaveBeenCalledTimes(2);
    } finally { words.mockRestore(); }
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
  });

  it('supplements independent forms for lookup and guessing without replacing existing meanings or merging ambiguous bases', async () => {
    await publishDictionary(pool, [...dictionary, word('walk', ['verb']), word('mean', ['verb']), word('means'), word('axe'), word('axis')]);
    const existing = (await pool.query('SELECT * FROM dictionary_definitions ORDER BY dictionary_entry_id,language_code,sense_order')).rows;
    const input = [
      ...definitionInflections('walked', 'verb', 'Past tense and participle of walk.'),
      ...definitionInflections('means', 'verb', 'Third person singular of mean.'),
      ...definitionInflections('axes', 'noun', 'Plural of axe.'),
      ...definitionInflections('axes', 'noun', 'Plural of axis.'),
    ];
    expect(await applyInflections(pool, await planInflections(pool, input))).toEqual({ entriesAdded: 3, definitionsAdded: 3, linksAdded: 5 });
    const repository = app.get(WordListRepository);
    expect(await repository.isDictionaryGameWord('walked')).toBe(true);
    expect(await repository.dictionaryGameWords(6)).toContain('walked');
    expect((await repository.searchDictionary('walked'))[0]).toMatchObject({ term: 'walked' });
    expect(await repository.getDictionaryDefinition('walked')).toContain('Definition of walk.');
    expect(await repository.getDictionaryDefinition('axes')).toContain('Definition of axe.');
    expect(await repository.getDictionaryDefinition('axes')).toContain('Definition of axis.');
    expect((await repository.searchDictionary('means'))[0]!.partOfSpeech).toEqual(['noun', 'verb']);
    const after = (await pool.query('SELECT * FROM dictionary_definitions WHERE dictionary_entry_id=ANY($1::uuid[]) ORDER BY dictionary_entry_id,language_code,sense_order', [existing.map(row => row.dictionary_entry_id)])).rows;
    expect(after).toEqual(existing);
    expect((await pool.query(`SELECT count(*)::int n FROM dictionary_inflections i JOIN dictionary_entries e ON e.id=i.form_entry_id WHERE e.term='axes'`)).rows[0].n).toBe(2);
    expect(await applyInflections(pool, await planInflections(pool, input))).toEqual({ entriesAdded: 0, definitionsAdded: 0, linksAdded: 0 });
  });

  it('rejects stale inflection plans and skips missing bases and self references', async () => {
    const plan = await planInflections(pool, [
      ...definitionInflections('cats', 'noun', 'Plural of cat.'),
      ...definitionInflections('cat', 'noun', 'Plural of cat.'),
      ...definitionInflections('missingwords', 'noun', 'Plural of missingword.'),
    ]);
    expect(plan.links).toHaveLength(1);
    expect(plan.skipped).toHaveLength(1);
    await publishDictionary(pool, dictionary);
    await expect(applyInflections(pool, plan)).rejects.toThrow('Dictionary changed');
    expect(await app.get(WordListRepository).isDictionaryGameWord('cats')).toBe(false);
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

  it.each([4, 5])('persists %i-letter ladders and pays exactly once for account and guest wins', async length => {
    const terms = length === 4
      ? ['cold','gold','hold','hole','home','come','some','same','name','game','gave','have','hate','late','lake','like','life','wife','wide','side','site']
      : ['stone','store','score','shore','share','spare','stare','start','smart'];
    await publishDictionary(pool, [...dictionary, ...terms.map(term => word(term))]);
    for (const cookie of [(await account()).cookie, await guest()]) {
      const before = await balance(cookie), startRequestId = randomUUID();
      const options = { kind: 'word-ladder', wordLength: length, startRequestId };
      const response = await request('/games', 'POST', options, cookie);
      expect(response.status, await response.clone().text()).toBe(201);
      const game = await response.json();
      expect(game).toMatchObject({ kind: 'word-ladder', coinCost: 1, winRewardCoins: length, wordLength: length });
      expect(game.ladder.startDefinition).toBeTruthy();
      expect(game.ladder).toMatchObject({ targetWords: 4 });
      expect(game.ladder).not.toHaveProperty('goalWord');
      expect(game).not.toHaveProperty('answer');
      expect(await balance(cookie)).toBe(before - 1);
      expect(await (await request('/games', 'POST', options, cookie)).json()).toMatchObject({ id: game.id });
      expect(await balance(cookie)).toBe(before - 1);
      const submit = (guess: string) => request(`/games/${game.id}/guesses`, 'POST', { guess }, cookie);
      expect(await (await submit(game.ladder.startWord)).json()).toMatchObject({ code: 'REPEATED_LADDER_WORD' });
      const illegal = await submit('z'.repeat(length));
      expect(illegal.status).toBe(400);
      expect(await illegal.json()).toMatchObject({ code: 'INVALID_GUESS' });
      const unknown = 'z' + game.ladder.startWord.slice(1);
      expect((await submit(unknown)).status).toBe(400);
      expect((await request(`/games/${game.id}/hints`, 'POST', { type: 'definition' }, cookie)).status).toBe(400);
      expect(await balance(cookie)).toBe(before - 1);
      // Find four distinct steps independently from the published dictionary.
      function findPath(path: string[]): string[] | undefined {
        if (path.length === 5) return path.slice(1);
        for (const next of terms) {
          if (path.includes(next) || [...next].filter((letter, index) => letter !== path.at(-1)![index]).length !== 1) continue;
          const found = findPath([...path, next]);
          if (found) return found;
        }
      }
      const route = findPath([game.ladder.startWord])!;
      expect(route).toHaveLength(4);
      expect(game.attemptLimit).toBe(4);
      const badMove = terms.find(term => [...term].filter((letter, index) => letter !== game.ladder.startWord[index]).length > 1)!;
      expect(await (await submit(badMove)).json()).toMatchObject({ code: 'INVALID_LADDER_STEP' });
      for (let index = 0; index < route.length; index++) {
        const result = await (await submit(route[index]!)).json();
        expect(result.feedback).toEqual([]);
        expect(result.attemptsRemaining).toBe(3 - index);
        expect(result.definition).toBeTruthy();
        expect(result.completed).toBe(index === 3);
        if (index === 3) expect(result).toMatchObject({ outcome: 'WON', rewardCoins: length });
        else {
          const repeated = await submit(index ? route[index - 1]! : game.ladder.startWord);
          expect(await repeated.json()).toMatchObject({ code: 'REPEATED_LADDER_WORD' });
        }
        const restored = await (await request(`/games/${game.id}`, 'GET', undefined, cookie)).json();
        expect(restored.guesses.map((step: { guess: string }) => step.guess)).toEqual(route.slice(0, index + 1));
        expect(restored.guesses.every((step: { feedback: string[] }) => step.feedback.length === 0)).toBe(true);
      }
      expect(await balance(cookie)).toBe(before + length - 1);
      const duplicates = await Promise.all([submit(route[3]!), submit(route[3]!)]);
      expect(duplicates.map(result => result.status)).toEqual([400, 400]);
      expect(await balance(cookie)).toBe(before + length - 1);
      const restored = await (await request(`/games/${game.id}`, 'GET', undefined, cookie)).json();
      expect(restored).toMatchObject({ status: 'won', coinChange: length - 1, attemptCount: 4, ladder: game.ladder, answer: route[3] });
      expect((await pool.query('SELECT answer FROM practice_games WHERE id=$1', [game.id])).rows[0].answer).toBe(route[3]);
    }
    for (const options of [{ wordLength: 3 }, { wordLength: 6 }, { difficulty: 'hard' }, { collectionId: appleCollection }]) {
      expect((await request('/games', 'POST', { kind: 'word-ladder', ...options }, (await account()).cookie)).status).toBe(400);
    }
  });

  it('refunds old goal ladders once and preserves current games during migration', async () => {
    await publishDictionary(pool, [...dictionary, ...['stone','store','score','shore','share','spare','stare','start','smart'].map(term => word(term))]);
    const cookies = [(await account()).cookie, await guest()];
    for (const cookie of cookies) {
      const game = await (await request('/games', 'POST', { kind: 'word-ladder', wordLength: 5 }, cookie)).json();
      await pool.query(`UPDATE practice_games SET ladder_state=(ladder_state-'targetWords') || '{"shortestSteps":4}'::jsonb WHERE id=$1`, [game.id]);
    }
    const currentCookie = await guest();
    const current = await (await request('/games', 'POST', { kind: 'word-ladder', wordLength: 5 }, currentCookie)).json();
    const balances = await Promise.all(cookies.map(balance));
    const migration = readFileSync('prisma/migrations/202610200100_word_chain/migration.sql', 'utf8');
    await pool.query(migration);
    expect(await Promise.all(cookies.map(balance))).toEqual(balances.map(coins => coins + 1));
    await pool.query(migration);
    expect(await Promise.all(cookies.map(balance))).toEqual(balances.map(coins => coins + 1));
    const old = (await pool.query("SELECT status,coin_change,active_state FROM practice_games WHERE id<>$1", [current.id])).rows;
    expect(old).toHaveLength(2);
    expect(old).toEqual(Array(2).fill({ status: 'cancelled', coin_change: 0, active_state: null }));
    expect(await (await request(`/games/${current.id}`, 'GET', undefined, currentCookie)).json()).toMatchObject({ status: 'active', ladder: { targetWords: 4 } });
    expect(await balance(currentCookie)).toBe(9);
  });

  it.each(['word-puzzle', 'word-ladder'])('giving up %s keeps the entry coin spent and reveals the answer', async kind => {
    await publishDictionary(pool, [...dictionary, ...['stone','store','score','shore','share','spare','stare','start','smart'].map(term => word(term))]);
    for (const cookie of [(await account()).cookie, await guest()]) {
      const before = await balance(cookie);
      const game = kind === 'word-puzzle' ? await start(cookie)
        : await (await request('/games', 'POST', { kind, wordLength: 5 }, cookie)).json();
      expect(await balance(cookie)).toBe(before - 1);
      const other = await account();
      expect((await request(`/games/${game.id}/give-up`, 'POST', {}, other.cookie)).status).toBe(404);
      const responses = await Promise.all([request(`/games/${game.id}/give-up`, 'POST', {}, cookie), request(`/games/${game.id}/give-up`, 'POST', {}, cookie)]);
      for (const response of responses) {
        expect(response.status).toBe(201);
        const result = await response.json();
        expect(result).toMatchObject({ status: 'lost', completed: true });
        expect(result.answer).toBeTruthy();
        expect(result.answerDefinition).toBeTruthy();
      }
      expect(await balance(cookie)).toBe(before - 1);
      expect((await request(`/games/${game.id}/guesses`, 'POST', { guess: 'apple' }, cookie)).status).toBe(400);
      const stored = (await pool.query('SELECT status,coin_change FROM practice_games WHERE id=$1', [game.id])).rows[0];
      expect(stored).toEqual({ status: 'lost', coin_change: -1 });
    }
  });

  it('uses 16 tables and enforces balances, ownership, and case-preserved identities', async () => {
    const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations'")).rows;
    expect(tables).toHaveLength(16);
    expect(tables).toContainEqual({ tablename: 'message' });
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
    await publishDictionary(pool, dictionary);
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

  it('refreshes cached catalogs, snapshots and word pools after publication without caching personal membership', async () => {
    const repository = app.get(WordListRepository);
    const before = await (await request('/collections/cefr-a1/snapshot')).json();
    await request('/collections');
    await request('/collections/game-options/all');
    expect((await repository.dictionaryGameWords(5)).includes('brave')).toBe(false);
    const updated = dictionary.map(row => row.term === 'apple'
      ? { ...row, senses: [{ partOfSpeech: 'noun', definitions: ['A fresh meaning.'], source: 'fixture' }] } : row);
    await publishDictionary(pool, [...updated, word('brave')]);
    const after = await (await request('/collections/cefr-a1/snapshot')).json();
    expect(after.collection.version === before.collection.version).toBe(false);
    expect(after.words.find((row: { lemma: string }) => row.lemma === 'apple').definition).toBe('A fresh meaning.');
    expect(await repository.dictionaryGameWords(5)).toContain('brave');
    const catalog = await (await request('/collections')).json();
    expect(catalog.find((row: { slug: string }) => row.slug === 'cefr-a1')).toEqual(after.collection);
    const user = await account();
    await request('/word-lists/' + user.id + '/dictionary-entries', 'POST', { terms: ['apple'] }, user.cookie);
    const personal = await (await request('/collections/cefr-a1/words', 'GET', undefined, user.cookie)).json();
    expect(personal.words.find((row: { lemma: string }) => row.lemma === 'apple').inMyWordList).toBe(true);
    const publicSnapshot = await (await request('/collections/cefr-a1/snapshot')).json();
    expect(publicSnapshot.words.find((row: { lemma: string }) => row.lemma === 'apple').inMyWordList).toBe(false);
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
    expect((await hint('partOfSpeech')).status).toBe(400);
    expect(await balance(user.cookie)).toBe(98);
    const restored = await (await request('/games/' + game.id, 'GET', undefined, user.cookie)).json();
    expect(restored).toMatchObject({ hints: { definition: 0 }, clues: { definition: 'Definition of _____.' }, hintCoinsSpent: 1 });
    expect(restored).not.toHaveProperty('answer');
    await request('/games/' + game.id + '/abandon', 'POST', {}, user.cookie);
    expect(await balance(user.cookie)).toBe(99);
    expect((await pool.query('SELECT coin_change FROM practice_games WHERE id=$1', [game.id])).rows[0].coin_change).toBe(-1);
  });

  it('does not charge for unavailable hints or commit a hint without enough coins', async () => {
    const user = await account(), game = await start(user.cookie);
    await pool.query("DELETE FROM dictionary_definitions WHERE dictionary_entry_id IN (SELECT id FROM dictionary_entries WHERE term='apple')");
    vi.spyOn(WordListsService.prototype, 'dictionaryDefinition').mockResolvedValueOnce('');
    const path = '/games/' + game.id + '/hints';
    const unavailable = await request(path, 'POST', { type: 'definition' }, user.cookie);
    expect(unavailable.status).toBe(400);
    expect(await balance(user.cookie)).toBe(99);
    await publishDictionary(pool, dictionary);
    await pool.query('UPDATE account_users SET coin_balance=0 WHERE id=$1', [user.id]);
    const denied = await request(path, 'POST', { type: 'definition' }, user.cookie);
    expect(denied.status).toBe(400);
    expect(await denied.json()).toMatchObject({ code: 'INSUFFICIENT_COINS' });
    expect(await balance(user.cookie)).toBe(0);
    const restored = await (await request('/games/' + game.id, 'GET', undefined, user.cookie)).json();
    expect(restored).toMatchObject({ hints: { definition: 1 }, clues: {}, hintCoinsSpent: 0 });
    const other = await account();
    expect((await request(path, 'POST', { type: 'definition' }, other.cookie)).status).toBe(404);
    expect(await balance(other.cookie)).toBe(100);
  });

  it('ignores removed word-class and synonym hints on legacy games', async () => {
    const user = await account();
    const game = await app.get(GameService).start(5, ['cover'], 'medium', 'user:' + user.id);
    await pool.query(`UPDATE practice_games SET active_state=active_state ||
      '{"hints":{"synonym":0,"partOfSpeech":0,"definition":1},"clues":{"synonym":"conceal","partOfSpeech":"noun"},"hintCoinsSpent":1}'::jsonb,
      coin_change=coin_change-1 WHERE id=$1`, [game.id]);
    await pool.query('UPDATE account_users SET coin_balance=coin_balance-1 WHERE id=$1', [user.id]);
    const restored = await (await request('/games/' + game.id, 'GET', undefined, user.cookie)).json();
    expect(restored).toMatchObject({ hints: { definition: 1 }, clues: {}, hintCoinsSpent: 1 });
    const clue = await request('/games/' + game.id + '/hints', 'POST', { type: 'definition' }, user.cookie);
    expect(await clue.json()).toMatchObject({ type: 'definition', text: 'Definition of _____.; Definition of _____.', cost: 1 });
    expect(await balance(user.cookie)).toBe(97);
    const state = (await pool.query('SELECT active_state FROM practice_games WHERE id=$1', [game.id])).rows[0].active_state;
    expect(state.clues).toEqual({ definition: 'Definition of _____.; Definition of _____.' });
    expect(state.hints).toEqual({ definition: 0 });
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

  it.each(['word-puzzle', 'word-ladder'])('allows replacing %s only before its first accepted word', async kind => {
    const terms = ['stone','store','score','shore','share','spare','stare','start','smart'];
    await publishDictionary(pool, [...dictionary, ...terms.map(term => word(term))]);
    for (const cookie of [(await account()).cookie, await guest()]) {
      const before = await balance(cookie);
      const options = { kind, wordLength: 5, ...(kind === 'word-puzzle' ? { collectionId: appleCollection } : {}) };
      const first = await (await request('/games', 'POST', options, cookie)).json();
      expect((await request(`/games/${first.id}/guesses`, 'POST', { guess: 'zzzzz' }, cookie)).status).toBe(400);
      const replacement = await request('/games', 'POST', options, cookie);
      expect(replacement.status).toBe(201);
      const game = await replacement.json();
      expect(await balance(cookie)).toBe(before - 1);
      const guess = kind === 'word-puzzle' ? 'paper'
        : terms.find(term => [...term].filter((letter, index) => letter !== game.ladder.startWord[index]).length === 1)!;
      expect((await request(`/games/${game.id}/guesses`, 'POST', { guess }, cookie)).status).toBe(201);
      for (const response of await Promise.all([
        request(`/games/${game.id}/abandon`, 'POST', {}, cookie),
        request('/games', 'POST', options, cookie),
      ])) {
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ code: 'PUZZLE_ALREADY_STARTED' });
      }
      expect(await balance(cookie)).toBe(before - 1);
      expect(await (await request(`/games/${game.id}`, 'GET', undefined, cookie)).json()).toMatchObject({ status: 'active', attemptCount: 1 });
      expect((await request(`/games/${game.id}/give-up`, 'POST', {}, cookie)).status).toBe(201);
      const next = await request('/games', 'POST', options, cookie);
      expect(next.status).toBe(201);
      await request(`/games/${(await next.json()).id}/abandon`, 'POST', {}, cookie);
      expect(await balance(cookie)).toBe(before - 1);
    }
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
