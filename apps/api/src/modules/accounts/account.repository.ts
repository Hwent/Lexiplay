import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';

export type AccountUser = { id: string; email: string | null; username: string; emailVerified: boolean };
export type AccountRecord = AccountUser & { passwordHash: string };

@Injectable()
export class AccountRepository implements OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://lexiplay:lexiplay@127.0.0.1:5432/lexiplay',
  });
  private schemaReady?: Promise<void>;

  async createUser(email: string | null, passwordHash: string, username: string): Promise<AccountUser | null> {
    await this.ensureSchema();
    try {
      const result = await this.pool.query<AccountUser>(
        'INSERT INTO account_users (email, password_hash, username) VALUES ($1, $2, $3) RETURNING id, email, username, email_verified AS "emailVerified"',
        [email, passwordHash, username],
      );
      return result.rows[0]!;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return null;
      throw error;
    }
  }

  async findUser(email: string): Promise<AccountRecord | null> {
    await this.ensureSchema();
    const result = await this.pool.query<AccountRecord>(
      'SELECT id, email, username, email_verified AS "emailVerified", password_hash AS "passwordHash" FROM account_users WHERE lower(email) = $1 OR lower(username) = $1', [email],
    );
    return result.rows[0] ?? null;
  }

  async findById(id: string): Promise<AccountRecord | null> {
    await this.ensureSchema();
    const result = await this.pool.query<AccountRecord>('SELECT id, email, username, email_verified AS "emailVerified", password_hash AS "passwordHash" FROM account_users WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async addEmail(id: string, email: string, expectedPasswordHash: string): Promise<AccountUser | null> {
    await this.ensureSchema();
    const result = await this.pool.query<AccountUser>(`UPDATE account_users SET email = $2, email_verified = false
      WHERE id = $1 AND email IS NULL AND password_hash = $3
      RETURNING id, email, username, email_verified AS "emailVerified"`, [id, email, expectedPasswordHash]);
    return result.rows[0] ?? null;
  }

  async deleteAccount(id: string, expectedPasswordHash: string): Promise<boolean> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const user = await client.query('SELECT id FROM account_users WHERE id = $1 AND password_hash = $2 FOR UPDATE', [id, expectedPasswordHash]);
      if (!user.rowCount) { await client.query('ROLLBACK'); return false; }
      // Games use account/guest owner keys. Lists, sessions, and action tokens have cascading foreign keys.
      const games = await client.query("SELECT to_regclass('practice_games') AS table_name");
      if (games.rows[0].table_name) await client.query('DELETE FROM practice_games WHERE owner_key = $1', [`user:${id}`]);
      await client.query('DELETE FROM account_users WHERE id = $1', [id]);
      await client.query('COMMIT');
      return true;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.ensureSchema();
    await this.pool.query('INSERT INTO account_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [userId, tokenHash, expiresAt]);
  }

  async findSession(tokenHash: string): Promise<AccountUser | null> {
    await this.ensureSchema();
    const result = await this.pool.query<AccountUser>(
      `SELECT users.id, users.email, users.username, users.email_verified AS "emailVerified" FROM account_sessions sessions
       JOIN account_users users ON users.id = sessions.user_id
       WHERE sessions.token_hash = $1 AND sessions.expires_at > now()`, [tokenHash],
    );
    return result.rows[0] ?? null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.ensureSchema();
    await this.pool.query('DELETE FROM account_sessions WHERE token_hash = $1', [tokenHash]);
  }

  async createAction(userId: string, tokenHash: string, purpose: 'reset' | 'verify', expiresAt: Date) {
    await this.ensureSchema();
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
    await this.ensureSchema();
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

  private ensureSchema(): Promise<void> {
    this.schemaReady ??= this.pool.query(`
      CREATE TABLE IF NOT EXISTS account_users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email varchar(254) UNIQUE,
        password_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE account_users ALTER COLUMN email DROP NOT NULL;
      ALTER TABLE account_users ADD COLUMN IF NOT EXISTS username text;
      ALTER TABLE account_users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
      UPDATE account_users SET username = 'learner_' || substring(replace(id::text, '-', ''), 1, 24) WHERE username IS NULL;
      ALTER TABLE account_users ALTER COLUMN username SET NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS account_users_username_idx ON account_users(lower(username));
      CREATE TABLE IF NOT EXISTS account_sessions (
        token_hash char(64) PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS account_sessions_user_id_idx ON account_sessions(user_id);
      CREATE TABLE IF NOT EXISTS account_actions (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES account_users(id) ON DELETE CASCADE, purpose text NOT NULL CHECK (purpose IN ('reset', 'verify')), expires_at timestamptz NOT NULL);
    `).then(() => undefined);
    return this.schemaReady;
  }
}
