import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { DIFFICULTIES, Difficulty, Game, GameStatus, Guess, score } from './game.types';

type Wallet = { id: string; coin_balance: number; kind: 'account' | 'guest'; claimed_at?: Date | null; expires_at?: Date };
type ActiveState = { guesses: string[]; hints: Game['hints']; revealedAbsent: string[]; revealedPresent: string[];
  clues?: Game['clues']; hintCoinsSpent?: number;
  coinCost: number; winRewardCoins: number; startedAt: string };
type GameRow = {
  id: string; start_request_id: string; answer: string; difficulty: Difficulty; attempt_count: number; coin_change: number;
  active_state: ActiveState | null; status: GameStatus; finished_at: Date | null;
  collection_id: string | null; collection_name: string; collection_author: string | null;
  coin_user_id: string | null; coin_guest_session_id: string | null;
};

@Injectable()
export class GameRepository implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgresql://lexiplay:lexiplay@127.0.0.1:5432/lexiplay' });

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
    const client = await this.pool.connect();
    try { const row = await this.walletRow(client, owner); return { coinBalance: row.coin_balance, kind: row.kind }; }
    finally { client.release(); }
  }

  async create(game: Game): Promise<Game> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('library-publication',0))");
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['start:' + game.startRequestId]);
      const previous = (await client.query('SELECT id FROM practice_games WHERE start_request_id=$1', [game.startRequestId])).rows[0];
      if (previous) {
        const existing = await this.load(client, previous.id, game.owner);
        if (existing.wordLength !== game.wordLength || existing.difficulty !== game.difficulty || (!existing.completed && existing.pool?.id !== game.pool?.id)) {
          throw new ConflictException('This start request was already used for a different game.');
        }
        await client.query('COMMIT'); return existing;
      }
      const wallet = await this.walletRow(client, game.owner, true);
      const answer = await this.resolveWord(client, game.answer);
      if (!answer) throw new BadRequestException('The dictionary changed. Choose a new game.');
      // Replacing a puzzle refunds its original payer in this same transaction.
      const unfinished = (await client.query(`SELECT g.id,g.coin_user_id,g.coin_guest_session_id,
        COALESCE((g.active_state->>'coinCost')::int,1) AS entry_cost FROM practice_games g
        LEFT JOIN guest_sessions s ON s.id=g.guest_session_id WHERE g.status='active'
        AND (g.user_id::text=$1 OR s.token_hash=$2) ORDER BY g.id`,
        [wallet.kind === 'account' ? wallet.id : null, wallet.kind === 'guest' ? game.owner.slice(6) : null])).rows;
      for (const previous of unfinished) {
        const payerTable = previous.coin_user_id ? 'account_users' : 'guest_sessions';
        const payerId = previous.coin_user_id ?? previous.coin_guest_session_id;
        await client.query(`SELECT id FROM ${payerTable} WHERE id=$1 FOR UPDATE`, [payerId]);
        const refunded = await client.query(`UPDATE practice_games SET status='cancelled',finished_at=now(),
          active_state=NULL,collection_id=NULL,coin_change=coin_change+$2 WHERE id=$1 AND status='active' RETURNING id`, [previous.id, previous.entry_cost]);
        if (refunded.rowCount) await client.query(`UPDATE ${payerTable} SET coin_balance=coin_balance+$2 WHERE id=$1`, [payerId, previous.entry_cost]);
      }
      const available = (await client.query(`SELECT coin_balance FROM ${wallet.kind === 'account' ? 'account_users' : 'guest_sessions'} WHERE id=$1`, [wallet.id])).rows[0].coin_balance;
      if (available < game.coinCost) throw new BadRequestException({ code: 'INSUFFICIENT_COINS', message: 'You need 1 coin to start this game.' });
      const table = wallet.kind === 'account' ? 'account_users' : 'guest_sessions';
      await client.query(`UPDATE ${table} SET coin_balance=coin_balance-$2 WHERE id=$1`, [wallet.id, game.coinCost]);
      const state: ActiveState = { guesses: [], hints: game.hints, revealedAbsent: [], revealedPresent: [],
        clues: game.clues, hintCoinsSpent: 0,
        coinCost: game.coinCost, winRewardCoins: game.winRewardCoins, startedAt: game.startedAt };
      await client.query(`INSERT INTO practice_games(id,start_request_id,user_id,guest_session_id,coin_user_id,coin_guest_session_id,
        answer,collection_id,difficulty,coin_change,active_state) VALUES($1,$2,$3,$4,$3,$4,$5,$6,$7,$8,$9)`,
        [game.id,game.startRequestId,wallet.kind === 'account' ? wallet.id : null,wallet.kind === 'guest' ? wallet.id : null,
          game.answer,game.pool?.id ?? null,game.difficulty,-game.coinCost,JSON.stringify(state)]);
      const created = await this.load(client, game.id, game.owner);
      await client.query('COMMIT'); return created;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  private async resolveWord(client: PoolClient, term: string) {
    return (await client.query<{ id: string }>(`SELECT e.id FROM dictionary_entries e
      WHERE e.term=$1 AND e.part_of_speech NOT IN ('proper noun','proper_noun','name')
      AND EXISTS(SELECT 1 FROM dictionary_definitions d WHERE d.dictionary_entry_id=e.id AND d.language_code='en')
      ORDER BY (e.term=$1) DESC,e.term,e.part_of_speech LIMIT 1`, [term])).rows[0];
  }

  async read(id: string, owner: string): Promise<Game> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const game = await this.load(client, id, owner);
      await client.query('COMMIT'); return game;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async change<T>(id: string, owner: string, operation: (game: Game) => T | Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('library-publication',0))");
      const payer = (await client.query<{ coin_user_id: string | null; coin_guest_session_id: string | null }>(
        'SELECT coin_user_id,coin_guest_session_id FROM practice_games WHERE id=$1', [id])).rows[0];
      if (!payer) throw new NotFoundException('Game not found.');
      const table = payer.coin_user_id ? 'account_users' : 'guest_sessions', payerId = payer.coin_user_id ?? payer.coin_guest_session_id;
      // Wallets precede game locks, matching starts, account deletion, and guest claims.
      const wallet = (await client.query<{ coin_balance: number }>(`SELECT coin_balance FROM ${table} WHERE id=$1 FOR UPDATE`, [payerId])).rows[0]!;
      const game = await this.load(client, id, owner, true);
      const wasCompleted = game.completed;
      const previousHintCost = game.hintCoinsSpent;
      const result = await operation(game);
      if (!wasCompleted) {
        const debit = game.hintCoinsSpent - previousHintCost;
        if (wallet.coin_balance < debit) throw new BadRequestException({ code: 'INSUFFICIENT_COINS', message: 'You need 1 coin to use this hint.' });
        const credit = game.status === 'won' ? game.winRewardCoins : game.status === 'cancelled' ? game.coinCost : 0;
        if (credit || debit) await client.query(`UPDATE ${table} SET coin_balance=coin_balance+$2 WHERE id=$1`, [payerId,credit-debit]);
        const state: ActiveState | null = game.completed ? null : {
          guesses: game.guesses.map(guess => guess.guess), hints: game.hints,
          clues: game.clues, hintCoinsSpent: game.hintCoinsSpent,
          revealedAbsent: game.revealedAbsent, revealedPresent: game.revealedPresent,
          coinCost: game.coinCost, winRewardCoins: game.winRewardCoins, startedAt: game.startedAt };
        await client.query(`UPDATE practice_games SET status=$2,finished_at=$3,active_state=$4,
          attempt_count=$5,coin_change=coin_change+$6,collection_id=CASE WHEN $7 THEN NULL ELSE collection_id END WHERE id=$1`,
          [id,game.status,game.completedAt,state ? JSON.stringify(state) : null,game.guesses.length,credit-debit,game.completed]);
      }
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async history(owner: string, page = 1, pageSize = 10) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const rows = (await client.query<{ id: string; status: GameStatus; finished_at: Date; attempt_count: number }>(
        "SELECT id,status,finished_at,attempt_count FROM practice_games WHERE user_id=$1 AND status IN ('won','lost') ORDER BY finished_at DESC,id", [owner.slice(5)])).rows;
      const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
      page = Math.min(page, totalPages);
      const recent = await this.rows(client, rows.slice((page - 1) * pageSize, page * pageSize).map(row => row.id), owner);
      const summaries = rows.map(row => ({ status: row.status, completedAt: row.finished_at.toISOString(), attemptCount: row.attempt_count }));
      await client.query('COMMIT'); return { summaries, recent, page, pageSize, totalPages };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async transferGuestGames(client: PoolClient, guest: string, owner: string): Promise<number> {
    const result = await client.query(`UPDATE practice_games SET user_id=$2,guest_session_id=NULL
      WHERE guest_session_id=(SELECT id FROM guest_sessions WHERE token_hash=$1) RETURNING id`, [guest.slice(6), owner.slice(5)]);
    return result.rowCount ?? 0;
  }

  private async load(client: PoolClient, id: string, owner: string, lock = false) {
    const game = (await this.rows(client, [id], owner, lock))[0];
    if (!game) throw new NotFoundException({ code: 'GAME_NOT_FOUND', message: 'This practice game could not be found.' });
    return game;
  }

  private async rows(client: PoolClient, ids: string[], owner: string, lock = false): Promise<Game[]> {
    if (!ids.length) return [];
    const { rows } = await client.query<GameRow>(`SELECT g.*,c.name AS collection_name,c.author AS collection_author
      FROM practice_games g LEFT JOIN guest_sessions s ON s.id=g.guest_session_id
      LEFT JOIN vocabulary_collections c ON c.id=g.collection_id
      WHERE g.id=ANY($1::uuid[]) AND (($2 LIKE 'user:%' AND g.user_id::text=substring($2 from 6))
        OR ($2 LIKE 'guest:%' AND s.token_hash=substring($2 from 7) AND s.claimed_at IS NULL AND s.expires_at>now()))
      ORDER BY g.finished_at DESC NULLS FIRST,g.id${lock ? ' FOR UPDATE OF g' : ''}`, [ids,owner]);
    const terms = [...new Set(rows.flatMap(row => [row.answer,...(row.active_state?.guesses ?? [])]))];
    const definitions = terms.length ? (await client.query<{term:string; definition:string}>(`SELECT chosen.term,
      string_agg(d.definition,'; ' ORDER BY e.part_of_speech,d.sense_order) definition FROM unnest($1::text[]) chosen(term)
      JOIN LATERAL (SELECT term FROM dictionary_entries WHERE lower(term COLLATE "default")=chosen.term
        ORDER BY (term=chosen.term) DESC,term LIMIT 1) spelling ON true
      JOIN dictionary_entries e ON e.term=spelling.term
      JOIN dictionary_definitions d ON d.dictionary_entry_id=e.id AND d.language_code='en' GROUP BY chosen.term`, [terms])).rows : [];
    const meanings = new Map(definitions.map(row => [row.term,row.definition]));
    return rows.map(row => {
      const state = row.active_state, rules = DIFFICULTIES[row.difficulty], completed = row.status !== 'active';
      const guesses: Guess[] = (state?.guesses ?? []).map((guess,index) => ({ guess,feedback:score(row.answer,guess),
        definition:meanings.get(guess) ?? '',attemptsRemaining:rules.attemptLimit-index-1,completed:false }));
      return { id:row.id,startRequestId:row.start_request_id,kind:'word-puzzle',owner,answer:row.answer,
        answerDefinition:meanings.get(row.answer) ?? '',attemptCount:row.attempt_count,coinChange:row.coin_change,
        wordLength:row.answer.length,difficulty:row.difficulty,attemptLimit:rules.attemptLimit,guesses,completed,status:row.status,
        startedAt:state?.startedAt ?? row.finished_at!.toISOString(),completedAt:row.finished_at?.toISOString() ?? null,
        hints: { synonym: completed ? 0 : state?.hints.synonym ?? 1, definition: completed ? 0 : state?.hints.definition ?? 1 },
        clues: state?.clues ?? {}, hintCoinsSpent: state?.hintCoinsSpent ?? 0,
        revealedAbsent:state?.revealedAbsent ?? [],revealedPresent:state?.revealedPresent ?? [],
        coinCost:state?.coinCost ?? (row.status === 'lost' ? -row.coin_change : 0),
        winRewardCoins:state?.winRewardCoins ?? 0,coinPayer:row.coin_user_id ? 'account' : 'guest',
        ...(row.status === 'cancelled' ? {cancellationReason:'This unfinished game was refunded.'} : {}),
        ...(row.collection_id ? {pool:{id:row.collection_id,name:row.collection_name,author:row.collection_author ?? ''}} : {}) };
    });
  }

  async onModuleDestroy() { await this.pool.end(); }
}
