import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { Difficulty, Game, GameStatus, Guess } from './game.types';

type Wallet = { id: string; coin_balance: number; kind: 'account' | 'guest'; claimed_at?: Date | null; expires_at?: Date };
type GameRow = {
  id: string; start_request_id: string; user_id: string | null; guest_session_id: string | null; token_hash: string | null;
  answer: string; answer_definition: string; word_length: number; difficulty: Difficulty; attempt_limit: number;
  unused_hints_remaining: number; present_hints_remaining: number; revealed_absent: string[]; revealed_present: string[];
  status: GameStatus; started_at: Date; finished_at: Date | null; cancellation_reason: string | null;
  collection_id: string | null; collection_name: string; collection_author: string | null;
  coin_cost: number; win_reward_coins: number; coin_user_id: string | null; coin_guest_session_id: string | null;
  reward_credited_at: Date | null; guesses: { guess: string; feedback: Guess['feedback']; definition: string; position: number }[];
};
const definitionSql = (alias: string) => `CASE WHEN ${alias}.retired_at IS NOT NULL THEN '' ELSE COALESCE(
  (SELECT string_agg(d.definition,'; ' ORDER BY e.part_of_speech,d.sense_order)
   FROM dictionary_entries e JOIN dictionary_definitions d ON d.dictionary_entry_id=e.id
   WHERE e.word_id=${alias}.id AND e.retired_at IS NULL),'') END`;

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
        if (existing.wordLength !== game.wordLength || existing.difficulty !== game.difficulty || existing.pool?.id !== game.pool?.id) {
          throw new ConflictException('This start request was already used for a different game.');
        }
        await client.query('COMMIT'); return existing;
      }
      const wallet = await this.walletRow(client, game.owner, true);
      const answer = await this.resolveWord(client, game.answer);
      if (!answer) throw new BadRequestException('The dictionary changed. Choose a new game.');
      const revision = (await client.query("SELECT id FROM library_revisions WHERE scope='dictionary' AND is_current")).rows[0];
      if (!revision) throw new BadRequestException('The dictionary has not been published.');
      if (wallet.coin_balance < game.coinCost) throw new BadRequestException({ code: 'INSUFFICIENT_COINS', message: 'You need 1 coin to start this game.' });
      const table = wallet.kind === 'account' ? 'account_users' : 'guest_sessions';
      await client.query(`UPDATE ${table} SET coin_balance=coin_balance-$2 WHERE id=$1`, [wallet.id, game.coinCost]);
      await client.query(`INSERT INTO practice_games(id,start_request_id,user_id,guest_session_id,coin_user_id,coin_guest_session_id,
        answer_word_id,collection_id,started_revision_id,word_length,difficulty,attempt_limit,unused_hints_remaining,present_hints_remaining,
        coin_cost,win_reward_coins) VALUES($1,$2,$3,$4,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13)`,
        [game.id, game.startRequestId, wallet.kind === 'account' ? wallet.id : null, wallet.kind === 'guest' ? wallet.id : null,
          answer.id, game.pool?.id ?? null, revision.id, game.wordLength, game.difficulty, game.attemptLimit, game.hints.unused, game.coinCost, game.winRewardCoins]);
      const created = await this.load(client, game.id, game.owner);
      await client.query('COMMIT'); return created;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  private async resolveWord(client: PoolClient, term: string) {
    return (await client.query<{ id: string }>(`SELECT w.id FROM dictionary_words w
      WHERE w.retired_at IS NULL AND lower(w.term COLLATE "default")=lower($1)
      AND EXISTS(SELECT 1 FROM dictionary_entries e JOIN dictionary_definitions d ON d.dictionary_entry_id=e.id WHERE e.word_id=w.id AND e.retired_at IS NULL)
      ORDER BY (w.term=$1) DESC,w.term LIMIT 1`, [term])).rows[0];
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
      await client.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [payerId]);
      const game = await this.load(client, id, owner, true);
      const previousCount = game.guesses.length, wasCompleted = game.completed;
      const result = await operation(game);
      const newlyWon = !wasCompleted && game.status === 'won';
      if (newlyWon) await client.query(`UPDATE ${table} SET coin_balance=coin_balance+$2 WHERE id=$1`, [payerId, game.winRewardCoins]);
      await client.query(`UPDATE practice_games SET status=$2,finished_at=$3,unused_hints_remaining=$4,present_hints_remaining=$5,
        revealed_absent=$6,revealed_present=$7,reward_credited_at=CASE WHEN $8 THEN now() ELSE reward_credited_at END WHERE id=$1`,
        [id, game.status, game.completedAt, game.hints.unused, game.hints.present, game.revealedAbsent, game.revealedPresent, newlyWon]);
      for (let position = previousCount; position < game.guesses.length; position++) {
        const guess = game.guesses[position]!, word = await this.resolveWord(client, guess.guess);
        if (!word) throw new BadRequestException('This guess is no longer in the dictionary.');
        await client.query('INSERT INTO practice_guesses(game_id,position,word_id,feedback) VALUES($1,$2,$3,$4)', [id, position + 1, word.id, guess.feedback]);
      }
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async history(owner: string): Promise<Game[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const ids = (await client.query<{ id: string }>("SELECT id FROM practice_games WHERE user_id=$1 AND status IN ('won','lost') ORDER BY finished_at DESC,id", [owner.slice(5)])).rows.map(row => row.id);
      const rows = await this.rows(client, ids, owner);
      await client.query('COMMIT'); return rows;
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
    const { rows } = await client.query<GameRow>(`SELECT g.*,w.term AS answer,${definitionSql('w')} AS answer_definition,
      s.token_hash,c.name AS collection_name,c.author AS collection_author,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('guess',lower(gw.term),'feedback',q.feedback,'position',q.position,
        'definition',${definitionSql('gw')}) ORDER BY q.position)
        FROM practice_guesses q JOIN dictionary_words gw ON gw.id=q.word_id WHERE q.game_id=g.id),'[]'::jsonb) AS guesses
      FROM practice_games g JOIN dictionary_words w ON w.id=g.answer_word_id
      LEFT JOIN guest_sessions s ON s.id=g.guest_session_id LEFT JOIN vocabulary_collections c ON c.id=g.collection_id
      WHERE g.id=ANY($1::uuid[]) AND (($2 LIKE 'user:%' AND g.user_id::text=substring($2 from 6))
        OR ($2 LIKE 'guest:%' AND s.token_hash=substring($2 from 7) AND s.claimed_at IS NULL AND s.expires_at>now()))
      ORDER BY g.finished_at DESC NULLS FIRST,g.id${lock ? ' FOR UPDATE OF g' : ''}`, [ids, owner]);
    return rows.map(row => {
      const completed = row.status !== 'active', answer = row.answer.toLowerCase();
      const guesses: Guess[] = row.guesses.map((guess, index) => {
        const last = index === row.guesses.length - 1 && (row.status === 'won' || row.status === 'lost');
        return { guess: guess.guess, feedback: guess.feedback, definition: guess.definition,
          attemptsRemaining: row.attempt_limit - guess.position, completed: last,
          ...(last ? { outcome: row.status === 'won' ? 'WON' as const : 'LOST' as const, answer, answerDefinition: row.answer_definition,
            ...(row.status === 'won' ? { rewardCoins: row.win_reward_coins } : {}) } : {}) };
      });
      return { id: row.id, startRequestId: row.start_request_id, kind: 'word-puzzle', owner, answer,
        wordLength: row.word_length, difficulty: row.difficulty, attemptLimit: row.attempt_limit, guesses, completed, status: row.status,
        startedAt: row.started_at.toISOString(), completedAt: row.finished_at?.toISOString() ?? null,
        hints: { unused: row.unused_hints_remaining, present: row.present_hints_remaining }, revealedAbsent: row.revealed_absent, revealedPresent: row.revealed_present,
        coinCost: row.coin_cost, winRewardCoins: row.win_reward_coins, coinPayer: row.coin_user_id ? 'account' : 'guest',
        ...(row.cancellation_reason ? { cancellationReason: row.cancellation_reason } : {}),
        ...(row.collection_id ? { pool: { id: row.collection_id, name: row.collection_name, author: row.collection_author ?? '' } } : {}) };
    });
  }

  async onModuleDestroy() { await this.pool.end(); }
}
