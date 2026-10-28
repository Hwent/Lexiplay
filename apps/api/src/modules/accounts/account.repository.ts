import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';

export type AccountUser = { id: string; email: string | null; username: string; emailVerified: boolean; coinBalance: number };
export type AccountRecord = AccountUser & { passwordHash: string };
export type CoinRanking = { rank: number; username: string; coinBalance: number };
export type ActivityRanking = { rank: number; username: string; value: number };

@Injectable()
export class AccountRepository implements OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://lexiplay:lexiplay@127.0.0.1:5432/lexiplay',
  });

  async createUser(email: string | null, passwordHash: string, username: string): Promise<AccountUser | null> {
    try {
      const result = await this.pool.query<AccountUser>(
        'INSERT INTO account_users (email, password_hash, username) VALUES ($1, $2, $3) RETURNING id, email, username, email_verified AS "emailVerified", coin_balance AS "coinBalance"',
        [email, passwordHash, username],
      );
      return result.rows[0]!;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return null;
      throw error;
    }
  }

  async findUser(email: string): Promise<AccountRecord | null> {
    const result = await this.pool.query<AccountRecord>(
      'SELECT id, email, username, email_verified AS "emailVerified", coin_balance AS "coinBalance", password_hash AS "passwordHash" FROM account_users WHERE lower(email) = $1 OR lower(username) = $1', [email],
    );
    return result.rows[0] ?? null;
  }

  async findById(id: string): Promise<AccountRecord | null> {
    const result = await this.pool.query<AccountRecord>('SELECT id, email, username, email_verified AS "emailVerified", coin_balance AS "coinBalance", password_hash AS "passwordHash" FROM account_users WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async coinRankings(): Promise<CoinRanking[]> {
    const result = await this.pool.query<CoinRanking>(`SELECT
      rank() OVER (ORDER BY coin_balance DESC)::int AS rank,
      username, coin_balance AS "coinBalance"
      FROM account_users ORDER BY coin_balance DESC,id LIMIT 20`);
    return result.rows;
  }

  async activityRankings(kind: 'practice' | 'streak'): Promise<ActivityRanking[]> {
    const metric = kind === 'practice' ? 'practice_count' : 'streak_days';
    const result = await this.pool.query<ActivityRanking>(`WITH finished AS (
      SELECT user_id,finished_at FROM practice_games WHERE user_id IS NOT NULL AND status IN ('won','lost') AND NOT gave_up
      UNION ALL SELECT user_id,finished_at FROM animal_guess_games WHERE user_id IS NOT NULL
    ), counts AS (
      SELECT user_id,count(*)::int AS practice_count FROM finished GROUP BY user_id
    ), days AS (
      SELECT DISTINCT user_id,(finished_at AT TIME ZONE 'UTC')::date AS day FROM finished
    ), runs AS (
      SELECT user_id,day,day - (row_number() OVER (PARTITION BY user_id ORDER BY day))::int AS run FROM days
    ), streaks AS (
      SELECT user_id,count(*)::int AS streak_days FROM runs GROUP BY user_id,run
      HAVING max(day) BETWEEN (now() AT TIME ZONE 'UTC')::date - 1 AND (now() AT TIME ZONE 'UTC')::date
    ), scores AS (
      SELECT u.id,u.username,c.practice_count,COALESCE(s.streak_days,0) AS streak_days
      FROM counts c JOIN account_users u ON u.id=c.user_id LEFT JOIN streaks s ON s.user_id=u.id
    ) SELECT rank() OVER (ORDER BY ${metric} DESC)::int AS rank,username,${metric} AS value
      FROM scores WHERE ${metric}>0 ORDER BY ${metric} DESC,id LIMIT 20`);
    return result.rows;
  }

  async addEmail(id: string, email: string, expectedPasswordHash: string): Promise<AccountUser | null> {
    const result = await this.pool.query<AccountUser>(`UPDATE account_users SET email = $2, email_verified = false
      WHERE id = $1 AND email IS NULL AND password_hash = $3
      RETURNING id, email, username, email_verified AS "emailVerified", coin_balance AS "coinBalance"`, [id, email, expectedPasswordHash]);
    return result.rows[0] ?? null;
  }

  async deleteAccount(id: string, expectedPasswordHash: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const user = await client.query('SELECT id FROM account_users WHERE id = $1 AND password_hash = $2 FOR UPDATE', [id, expectedPasswordHash]);
      if (!user.rowCount) { await client.query('ROLLBACK'); return false; }
      await client.query('DELETE FROM account_users WHERE id = $1', [id]);
      await client.query('COMMIT');
      return true;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.pool.query('INSERT INTO account_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [userId, tokenHash, expiresAt]);
  }

  async findSession(tokenHash: string): Promise<AccountUser | null> {
    const result = await this.pool.query<AccountUser>(
      `SELECT users.id, users.email, users.username, users.email_verified AS "emailVerified", coin_balance AS "coinBalance" FROM account_sessions sessions
       JOIN account_users users ON users.id = sessions.user_id
       WHERE sessions.token_hash = $1 AND sessions.expires_at > now()`, [tokenHash],
    );
    return result.rows[0] ?? null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query('DELETE FROM account_sessions WHERE token_hash = $1', [tokenHash]);
  }

  async createAction(userId: string, tokenHash: string, purpose: 'reset' | 'verify', expiresAt: Date) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM account_users WHERE id = $1 FOR UPDATE', [userId]);
      await client.query('DELETE FROM account_actions WHERE user_id = $1 AND purpose = $2', [userId, purpose]);
      await client.query('INSERT INTO account_actions (user_id, token_hash, purpose, expires_at) VALUES ($1, $2, $3, $4)', [userId, tokenHash, purpose, expiresAt]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async consumeAction(tokenHash: string, purpose: 'reset' | 'verify', passwordHash?: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const candidate = await client.query<{ user_id: string }>('SELECT user_id FROM account_actions WHERE token_hash = $1 AND purpose = $2', [tokenHash, purpose]);
      if (candidate.rows[0]) await client.query('SELECT id FROM account_users WHERE id = $1 FOR UPDATE', [candidate.rows[0].user_id]);
      const action = await client.query<{ user_id: string }>('SELECT user_id FROM account_actions WHERE token_hash = $1 AND purpose = $2 AND expires_at > now() FOR UPDATE', [tokenHash, purpose]);
      const userId = action.rows[0]?.user_id;
      if (!userId) { await client.query('ROLLBACK'); return false; }
      if (purpose === 'reset') {
        await client.query('UPDATE account_users SET password_hash = $2 WHERE id = $1', [userId, passwordHash]);
        await client.query('DELETE FROM account_sessions WHERE user_id = $1', [userId]);
      } else await client.query('UPDATE account_users SET email_verified = true WHERE id = $1', [userId]);
      await client.query('DELETE FROM account_actions WHERE token_hash = $1', [tokenHash]);
      await client.query('COMMIT');
      return true;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async onModuleDestroy() { await this.pool.end(); }

}
