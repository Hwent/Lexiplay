import { Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { Game, Guess } from './game.types';

// Games and accepted guesses are committed together. Row locks serialize guesses and hints.
@Injectable()
export class GameRepository implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgresql://lexiplay:lexiplay@127.0.0.1:5432/lexiplay' });
  private schemaReady?: Promise<void>;

  async create(game: Game) {
    await this.ensureSchema();
    const { guesses: _guesses, ...state } = game;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (game.owner.startsWith('user:')) {
        const user = await client.query('SELECT id FROM account_users WHERE id = $1 FOR KEY SHARE', [game.owner.slice(5)]);
        if (!user.rowCount) throw new NotFoundException('This account no longer exists.');
      }
      await client.query('INSERT INTO practice_games (id, owner_key, state) VALUES ($1, $2, $3)', [game.id, game.owner, JSON.stringify(state)]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async read(id: string, owner: string): Promise<Game> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const game = await this.load(client, id, owner);
      await client.query('COMMIT');
      return game;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async change<T>(id: string, owner: string, operation: (game: Game) => T | Promise<T>): Promise<T> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const game = await this.load(client, id, owner, true);
      const previousCount = game.guesses.length;
      const result = await operation(game);
      const { guesses, ...state } = game;
      await client.query('UPDATE practice_games SET state = $2 WHERE id = $1', [id, JSON.stringify(state)]);
      for (let position = previousCount; position < guesses.length; position++) {
        await client.query('INSERT INTO practice_guesses (game_id, position, result) VALUES ($1, $2, $3)', [id, position, JSON.stringify(guesses[position])]);
      }
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async history(owner: string): Promise<Game[]> {
    await this.ensureSchema();
    const result = await this.pool.query<{ state: Omit<Game, 'guesses'>; guesses: Guess[] }>(`
      SELECT g.state, COALESCE(jsonb_agg(q.result ORDER BY q.position) FILTER (WHERE q.game_id IS NOT NULL), '[]'::jsonb) AS guesses
      FROM practice_games g LEFT JOIN practice_guesses q ON q.game_id = g.id
      WHERE g.owner_key = $1 AND g.state->>'completed' = 'true'
      GROUP BY g.id ORDER BY g.state->>'completedAt' DESC`, [owner]);
    return result.rows.map(row => ({ ...row.state, guesses: row.guesses }));
  }

  private async load(client: PoolClient, id: string, owner: string, lock = false): Promise<Game> {
    const result = await client.query<{ state: Omit<Game, 'guesses'> }>(`SELECT state FROM practice_games WHERE id = $1 AND owner_key = $2${lock ? ' FOR UPDATE' : ''}`, [id, owner]);
    if (!result.rows[0]) throw new NotFoundException({ code: 'GAME_NOT_FOUND', message: 'This practice game could not be found.' });
    const guesses = await client.query<{ result: Guess }>('SELECT result FROM practice_guesses WHERE game_id = $1 ORDER BY position', [id]);
    return { ...result.rows[0].state, guesses: guesses.rows.map(row => row.result) };
  }

  private ensureSchema(): Promise<void> {
    this.schemaReady ??= this.pool.query(`
      CREATE TABLE IF NOT EXISTS practice_games (id uuid PRIMARY KEY, owner_key text NOT NULL, state jsonb NOT NULL);
      CREATE INDEX IF NOT EXISTS practice_games_owner_idx ON practice_games(owner_key);
      CREATE TABLE IF NOT EXISTS practice_guesses (game_id uuid REFERENCES practice_games(id) ON DELETE CASCADE, position integer NOT NULL, result jsonb NOT NULL, PRIMARY KEY(game_id, position));
    `).then(() => undefined);
    return this.schemaReady;
  }
  async onModuleDestroy() { await this.pool.end(); }
}
