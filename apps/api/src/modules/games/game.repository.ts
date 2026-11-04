import { DatabasePool } from '../../database/database.module';
import { playableEntrySql, playableProperNounSql } from '../word-lists/game-entry';
import { Inject, BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { LEGACY_ATTEMPT_LIMITS, Difficulty, Game, GameStatus, Guess, PUZZLE_ALREADY_STARTED, score } from './game.types';
import { LADDER_WORDS } from './word-ladder';
import { AnimalCompletionDto } from './game.dto';

type Wallet = { id: string; coin_balance: number; kind: 'account' | 'guest'; claimed_at?: Date | null; expires_at?: Date };
type UnfinishedGame = { id: string; coin_user_id: string | null; coin_guest_session_id: string | null; entry_cost: number };
type ActiveState = { guesses: string[]; hints: Partial<Game['hints']>; revealedAbsent: string[]; revealedPresent: string[];
  clues?: Game['clues']; hintCoinsSpent?: number;
  coinCost: number; winRewardCoins: number; startedAt: string };
type GameRow = {
  meanings?: Record<string, string>;
  owner_coin_balance?: number;
  id: string; start_request_id: string; answer: string; difficulty: Difficulty; attempt_count: number; coin_change: number;
  active_state: ActiveState | null; status: GameStatus; finished_at: Date | null;
  ladder_state: { startWord: string; targetWords?: number; guesses?: string[] } | null;
  collection_id: string | null; collection_name: string; collection_author: string | null;
  coin_user_id: string | null; coin_guest_session_id: string | null;
  gave_up: boolean;
};

function definitionRows(terms: string) {
  return `SELECT chosen.term,string_agg(d.definition,'; ' ORDER BY e.part_of_speech,d.sense_order) AS definition
    FROM (SELECT DISTINCT unnest(${terms}) AS term) chosen
    JOIN LATERAL (SELECT term FROM dictionary_entries WHERE lower(term COLLATE "default")=chosen.term
      ORDER BY (term=chosen.term) DESC,term LIMIT 1) spelling ON true
    JOIN dictionary_entries e ON e.term=spelling.term
      OR (lower(e.term COLLATE "default")=chosen.term AND ${playableProperNounSql})
    JOIN dictionary_definitions d ON d.dictionary_entry_id=e.id AND d.language_code='en' GROUP BY chosen.term`;
}

const gameMeanings = `COALESCE((SELECT jsonb_object_agg(term,definition) FROM (${definitionRows(`
  ARRAY[g.answer,g.ladder_state->>'startWord'] || ARRAY(SELECT jsonb_array_elements_text(
    COALESCE(g.active_state->'guesses',g.ladder_state->'guesses','[]'::jsonb)))`)}) meanings),'{}'::jsonb)`;

@Injectable()
export class GameRepository {
  constructor(@Inject(DatabasePool) private readonly pool: DatabasePool) {}

  private async walletRow(client: PoolClient, owner: string, lock = false): Promise<Wallet> {
    if (owner.startsWith('user:')) {
      const row = (await client.query<Wallet>(`SELECT id,coin_balance,'account' AS kind FROM account_users WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [owner.slice(5)])).rows[0];
      if (!row) throw new NotFoundException('This account no longer exists.');
      return row;
    }
    if (!/^guest:[0-9a-f]{64}$/.test(owner)) throw new NotFoundException('Your guest session is unavailable. Reload before playing.');
    const hash = owner.slice(6);
    await client.query("INSERT INTO guest_sessions(token_hash,expires_at) VALUES($1,now()+interval '30 days') ON CONFLICT(token_hash) DO NOTHING", [hash]);
    const row = (await client.query<Wallet>(`SELECT id,coin_balance,claimed_at,expires_at,'guest' AS kind FROM guest_sessions WHERE token_hash=$1${lock ? ' FOR UPDATE' : ''}`, [hash])).rows[0]!;
    if (row.claimed_at || row.expires_at! <= new Date()) throw new ConflictException('Your guest session changed. Reload before playing.');
    return row;
  }

  async wallet(owner: string) {
    if (owner.startsWith('user:')) {
      const row = (await this.pool.query<{ coinBalance: number; activeGameId: string | null }>(`SELECT
        coin_balance AS "coinBalance",(SELECT id FROM practice_games WHERE user_id=u.id AND status='active'
          ORDER BY attempt_count DESC,id LIMIT 1) AS "activeGameId" FROM account_users u WHERE id=$1`, [owner.slice(5)])).rows[0];
      if (!row) throw new NotFoundException('This account no longer exists.');
      return { ...row, kind: 'account' };
    }
    const client = await this.pool.connect();
    try {
      const row = await this.walletRow(client, owner);
      const active = (await client.query<{ id: string }>(`SELECT id FROM practice_games
        WHERE status='active' AND ${row.kind === 'account' ? 'user_id' : 'guest_session_id'}=$1
        ORDER BY attempt_count DESC,id LIMIT 1`, [row.id])).rows[0];
      return { coinBalance: row.coin_balance, kind: row.kind, activeGameId: active?.id ?? null };
    }
    finally { client.release(); }
  }

  async completeAnimal(round: AnimalCompletionDto, owner: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const wallet = await this.walletRow(client, owner, true);
      const userId = wallet.kind === 'account' ? wallet.id : null;
      const guestId = wallet.kind === 'guest' ? wallet.id : null;
      const inserted = await client.query(`INSERT INTO animal_guess_games(id,user_id,guest_session_id,status,question_count,guess_count,finished_at)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING RETURNING id`,
        [round.roundId,userId,guestId,round.status,round.questionCount,round.guessCount,round.completedAt]);
      if (!inserted.rowCount) {
        const existing = (await client.query('SELECT user_id,guest_session_id FROM animal_guess_games WHERE id=$1', [round.roundId])).rows[0];
        if (existing.user_id !== userId || existing.guest_session_id !== guestId) throw new ConflictException('This round belongs to another player.');
      }
      await client.query('COMMIT');
      return { recorded: true };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async create(game: Game): Promise<Game> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN; SELECT pg_advisory_xact_lock_shared(hashtextextended('library-publication',0))");
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['start:' + game.startRequestId]);
      const previous = (await client.query('SELECT id FROM practice_games WHERE start_request_id=$1', [game.startRequestId])).rows[0];
      if (previous) {
        const existing = await this.load(client, previous.id, game.owner);
        if (existing.kind !== game.kind || existing.wordLength !== game.wordLength || existing.difficulty !== game.difficulty || (!existing.completed && existing.pool?.id !== game.pool?.id)) {
          throw new ConflictException('This start request was already used for a different game.');
        }
        await client.query('COMMIT'); return existing;
      }
      const wallet = await this.walletRow(client, game.owner, true);
      const table = wallet.kind === 'account' ? 'account_users' : 'guest_sessions';
      const { rows: [setup] } = await client.query<{ valid: boolean; unfinished: UnfinishedGame[] }>(`SELECT EXISTS(
        SELECT 1 FROM dictionary_entries e WHERE lower(e.term COLLATE "default")=lower($1) AND ${playableEntrySql}
        AND EXISTS(SELECT 1 FROM dictionary_definitions d WHERE d.dictionary_entry_id=e.id AND d.language_code='en')
      ) AS valid,COALESCE((SELECT jsonb_agg(pending ORDER BY pending.id) FROM (
        SELECT g.id,g.coin_user_id,g.coin_guest_session_id,COALESCE((g.active_state->>'coinCost')::int,1) AS entry_cost
        FROM practice_games g LEFT JOIN guest_sessions s ON s.id=g.guest_session_id WHERE g.status='active'
        AND (g.user_id::text=$2 OR s.token_hash=$3)
      ) pending),'[]'::jsonb) AS unfinished`, [game.answer,wallet.kind === 'account' ? wallet.id : null,
        wallet.kind === 'guest' ? game.owner.slice(6) : null]);
      if (!setup!.valid) throw new BadRequestException('The dictionary changed. Choose a new game.');
      // Only untried puzzles can be replaced and refunded to their original payer.
      for (const previous of setup!.unfinished) {
        const payerTable = previous.coin_user_id ? 'account_users' : 'guest_sessions';
        const payerId = previous.coin_user_id ?? previous.coin_guest_session_id;
        if (payerTable !== table || payerId !== wallet.id) await client.query(`SELECT id FROM ${payerTable} WHERE id=$1 FOR UPDATE`, [payerId]);
        const current = (await client.query<{ status: GameStatus; attempt_count: number }>(
          'SELECT status,attempt_count FROM practice_games WHERE id=$1 FOR UPDATE', [previous.id])).rows[0]!;
        if (current.status === 'active' && current.attempt_count > 0) throw new ConflictException(PUZZLE_ALREADY_STARTED);
        await client.query(`WITH refunded AS (UPDATE practice_games SET status='cancelled',finished_at=now(),
          active_state=NULL,collection_id=NULL,coin_change=coin_change+$2 WHERE id=$1 AND status='active' RETURNING id)
          UPDATE ${payerTable} SET coin_balance=coin_balance+$2 WHERE id=$3 AND EXISTS(SELECT 1 FROM refunded)`,
          [previous.id,previous.entry_cost,payerId]);
      }
      const paid = (await client.query<{ coin_balance: number }>(`UPDATE ${table} SET coin_balance=coin_balance-$2
        WHERE id=$1 AND coin_balance>=$2 RETURNING coin_balance`, [wallet.id,game.coinCost])).rows[0];
      if (!paid) throw new BadRequestException({ code: 'INSUFFICIENT_COINS', message: 'You need 1 coin to start this game.' });
      const state: ActiveState = { guesses: [], hints: game.hints, revealedAbsent: [], revealedPresent: [],
        clues: game.clues, hintCoinsSpent: 0,
        coinCost: game.coinCost, winRewardCoins: game.winRewardCoins, startedAt: game.startedAt };
      const { rows } = await client.query<GameRow>(`WITH inserted AS (INSERT INTO practice_games(
        id,start_request_id,user_id,guest_session_id,coin_user_id,coin_guest_session_id,answer,collection_id,difficulty,coin_change,active_state,ladder_state)
        VALUES($1,$2,$3,$4,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *)
        SELECT g.*,c.name AS collection_name,c.author AS collection_author,${gameMeanings} AS meanings,
        $11::int AS owner_coin_balance FROM inserted g LEFT JOIN vocabulary_collections c ON c.id=g.collection_id`,
        [game.id,game.startRequestId,wallet.kind === 'account' ? wallet.id : null,wallet.kind === 'guest' ? wallet.id : null,
          game.answer,game.pool?.id ?? null,game.difficulty,-game.coinCost,JSON.stringify(state),game.ladder ? JSON.stringify(game.ladder) : null,paid.coin_balance]);
      const created = this.hydrateRows(rows, game.owner)[0]!;
      await client.query('COMMIT'); return created;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async read(id: string, owner: string): Promise<Game> {
    const client = await this.pool.connect();
    try {
      // The game and its meanings share a single statement snapshot.
      return await this.load(client, id, owner);
    }
    finally { client.release(); }
  }

  async change<T extends object>(id: string, owner: string, operation: (game: Game, client?: PoolClient) => T | Promise<T>, options: { includeDefinitions?: boolean } = {}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const wallet = await this.lockPayer(client, id);
      const table = wallet.kind === 'account' ? 'account_users' : 'guest_sessions';
      const game = await this.load(client, id, owner, true, options.includeDefinitions !== false);
      const wasCompleted = game.completed;
      const previousHintCost = game.hintCoinsSpent;
      const result = await operation(game, client);
      let balance = wallet.coin_balance;
      if (!wasCompleted) {
        const debit = game.hintCoinsSpent - previousHintCost;
        if (wallet.coin_balance < debit) throw new BadRequestException({ code: 'INSUFFICIENT_COINS', message: 'You need 1 coin to use this hint.' });
        const credit = game.status === 'won' ? game.winRewardCoins : game.status === 'cancelled' ? game.coinCost : 0;
        balance += credit - debit;
        const state: ActiveState | null = game.completed ? null : {
          guesses: game.guesses.map(guess => guess.guess), hints: game.hints,
          clues: game.clues, hintCoinsSpent: game.hintCoinsSpent,
          revealedAbsent: game.revealedAbsent, revealedPresent: game.revealedPresent,
          coinCost: game.coinCost, winRewardCoins: game.winRewardCoins, startedAt: game.startedAt };
        await client.query(`WITH changed_wallet AS (
          UPDATE ${table} SET coin_balance=coin_balance+$11 WHERE id=$12 AND $11<>0 RETURNING id
        ) UPDATE practice_games SET status=$2,finished_at=$3,active_state=$4,
          attempt_count=$5,coin_change=coin_change+$6,collection_id=CASE WHEN $7 THEN NULL ELSE collection_id END,
          ladder_state=$8,answer=$9,gave_up=$10 WHERE id=$1`,
          [id,game.status,game.completedAt,state ? JSON.stringify(state) : null,game.guesses.length,credit-debit,game.completed,
            game.ladder ? JSON.stringify({ startWord: game.ladder.startWord, targetWords: game.ladder.targetWords,
              ...(game.completed ? { guesses: game.guesses.map(guess => guess.guess) } : {}) }) : null,game.answer,game.gaveUp ?? false,credit-debit,wallet.id]);
      }
      await client.query('COMMIT');
      // A claimed guest puzzle still pays its original guest wallet, not the account viewing it.
      const sameWallet = wallet.kind === 'account' ? owner === 'user:' + wallet.id : owner.startsWith('guest:');
      return sameWallet ? { ...result, wallet: { coinBalance: balance, kind: wallet.kind } } : result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  private async lockPayer(client: PoolClient, id: string): Promise<Wallet> {
    // Publication lock, then payer wallet, then the caller loads/locks the game.
    const { rows } = await client.query<Wallet>(`WITH library_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock_shared(hashtextextended('library-publication',0))
    ), payer AS MATERIALIZED (
      SELECT g.coin_user_id,g.coin_guest_session_id FROM practice_games g CROSS JOIN library_lock WHERE g.id=$1
    ), account_wallet AS MATERIALIZED (
      SELECT u.id,u.coin_balance,'account'::text AS kind FROM account_users u JOIN payer p ON p.coin_user_id=u.id FOR UPDATE OF u
    ), guest_wallet AS MATERIALIZED (
      SELECT s.id,s.coin_balance,'guest'::text AS kind FROM guest_sessions s JOIN payer p ON p.coin_guest_session_id=s.id FOR UPDATE OF s
    ) SELECT * FROM account_wallet UNION ALL SELECT * FROM guest_wallet`, [id]);
    if (!rows[0]) throw new NotFoundException('Game not found.');
    return rows[0];
  }

  async history(owner: string, page = 1, pageSize = 10) {
    const client = await this.pool.connect();
    try {
      const rows = (await client.query<GameRow & { summaries: { status: GameStatus; completedAt: string; attemptCount: number }[] }>(`
        WITH history AS MATERIALIZED (
          SELECT id,status,finished_at,attempt_count FROM practice_games
          WHERE user_id=$1 AND status IN ('won','lost')
        ), selected AS (
          SELECT id FROM history ORDER BY finished_at DESC,id LIMIT $2::int
          OFFSET (LEAST($3::int,GREATEST(1,ceil((SELECT count(*) FROM history)::numeric/$2::int)::int))-1)*$2
        )
        SELECT g.*,c.name AS collection_name,c.author AS collection_author,${gameMeanings} AS meanings,
          CASE WHEN row_number() OVER (ORDER BY g.finished_at DESC,g.id)=1 THEN
            (SELECT jsonb_agg(jsonb_build_object('status',status,'completedAt',finished_at,'attemptCount',attempt_count)
              ORDER BY finished_at DESC,id) FROM history) END AS summaries
        FROM selected JOIN practice_games g USING(id)
        LEFT JOIN vocabulary_collections c ON c.id=g.collection_id
        ORDER BY g.finished_at DESC,g.id`, [owner.slice(5),pageSize,page])).rows;
      const summaries = (rows[0]?.summaries ?? []).map(row => ({ ...row, completedAt: new Date(row.completedAt).toISOString() }));
      const totalPages = Math.max(1, Math.ceil(summaries.length / pageSize));
      page = Math.min(page, totalPages);
      const recent = this.hydrateRows(rows, owner);
      return { summaries, recent, page, pageSize, totalPages };
    }
    finally { client.release(); }
  }

  async transferGuestGames(client: PoolClient, guest: string, owner: string): Promise<number> {
    const result = await client.query(`UPDATE practice_games SET user_id=$2,guest_session_id=NULL
      WHERE guest_session_id=(SELECT id FROM guest_sessions WHERE token_hash=$1) RETURNING id`, [guest.slice(6), owner.slice(5)]);
    const animals = await client.query(`UPDATE animal_guess_games SET user_id=$2,guest_session_id=NULL
      WHERE guest_session_id=(SELECT id FROM guest_sessions WHERE token_hash=$1) RETURNING id`, [guest.slice(6), owner.slice(5)]);
    return (result.rowCount ?? 0) + (animals.rowCount ?? 0);
  }

  private async load(client: PoolClient, id: string, owner: string, lock = false, includeDefinitions = true) {
    const game = (await this.rows(client, [id], owner, lock, includeDefinitions))[0];
    if (!game) throw new NotFoundException({ code: 'GAME_NOT_FOUND', message: 'This practice game could not be found.' });
    return game;
  }

  private async rows(client: PoolClient, ids: string[], owner: string, lock = false, includeDefinitions = true): Promise<Game[]> {
    if (!ids.length) return [];
    const { rows } = await client.query<GameRow>(`SELECT g.*,c.name AS collection_name,c.author AS collection_author,
      ${includeDefinitions ? gameMeanings : "'{}'::jsonb"} AS meanings,
      CASE WHEN $2 LIKE 'user:%' THEN u.coin_balance ELSE s.coin_balance END AS owner_coin_balance
      FROM practice_games g LEFT JOIN guest_sessions s ON s.id=g.guest_session_id
      LEFT JOIN account_users u ON u.id=g.user_id
      LEFT JOIN vocabulary_collections c ON c.id=g.collection_id
      WHERE g.id=ANY($1::uuid[]) AND (($2 LIKE 'user:%' AND g.user_id::text=substring($2 from 6))
        OR ($2 LIKE 'guest:%' AND s.token_hash=substring($2 from 7) AND s.claimed_at IS NULL AND s.expires_at>now()))
      ORDER BY g.finished_at DESC NULLS FIRST,g.id${lock ? ' FOR UPDATE OF g' : ''}`, [ids,owner]);
    return this.hydrateRows(rows, owner);
  }

  private hydrateRows(rows: GameRow[], owner: string): Game[] {
    return rows.map(row => {
      const meanings = new Map(Object.entries(row.meanings ?? {}));
      const state = row.active_state, completed = row.status !== 'active';
      const ladder = row.ladder_state;
      const attemptLimit = ladder ? ladder.targetWords ?? (row.attempt_count || LADDER_WORDS) : LEGACY_ATTEMPT_LIMITS[row.difficulty];
      const steps = state?.guesses ?? ladder?.guesses ?? [];
      const guesses: Guess[] = steps.map((guess,index) => ({ guess,
        feedback:ladder ? [] : score(row.answer,guess),
        definition:meanings.get(guess) ?? '',attemptsRemaining:attemptLimit-index-1,completed:completed && index === steps.length - 1 }));
      return { id:row.id,startRequestId:row.start_request_id,kind:ladder ? 'word-ladder' : 'word-puzzle',owner,answer:row.answer,
        ...(ladder ? { ladder: { startWord: ladder.startWord, targetWords: attemptLimit, startDefinition: meanings.get(ladder.startWord) ?? '' } } : {}),
        answerDefinition:meanings.get(row.answer) ?? '',attemptCount:row.attempt_count,coinChange:row.coin_change,
        wordLength:row.answer.length,difficulty:row.difficulty,attemptLimit,guesses,completed,status:row.status,gaveUp:row.gave_up,
        startedAt:state?.startedAt ?? row.finished_at!.toISOString(),completedAt:row.finished_at?.toISOString() ?? null,
        hints: ladder ? { definition: 0, nextWord: completed || state?.clues?.nextWord ? 0 : 1 } : { definition: completed ? 0 : state?.hints.definition ?? 1 },
        clues: ladder ? { ...(state?.clues?.nextWord ? { nextWord: state.clues.nextWord } : {}) }
          : { ...(state?.clues?.definition ? { definition: state.clues.definition } : {}) }, hintCoinsSpent: state?.hintCoinsSpent ?? 0,
        revealedAbsent:state?.revealedAbsent ?? [],revealedPresent:state?.revealedPresent ?? [],
        coinCost:state?.coinCost ?? (row.status === 'lost' ? -row.coin_change : 0),
        winRewardCoins:ladder ? (ladder.targetWords ? row.answer.length : 5) : state?.winRewardCoins ?? 0,coinPayer:row.coin_user_id ? 'account' : 'guest',
        ...(row.owner_coin_balance !== undefined ? { wallet: { coinBalance: row.owner_coin_balance, kind: owner.startsWith('user:') ? 'account' as const : 'guest' as const } } : {}),
        ...(row.status === 'cancelled' ? {cancellationReason:'This unfinished game was refunded.'} : {}),
        ...(row.collection_id ? {pool:{id:row.collection_id,name:row.collection_name,author:row.collection_author ?? ''}} : {}) };
    });
  }
}
