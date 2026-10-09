import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';

export type AccountUser = { id: string; email: string };
export type AccountRecord = AccountUser & { passwordHash: string };

@Injectable()
export class AccountRepository implements OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://lexiplay:lexiplay@127.0.0.1:5432/lexiplay',
  });
  private schemaReady?: Promise<void>;

  async createUser(email: string, passwordHash: string): Promise<AccountUser | null> {
    await this.ensureSchema();
    try {
      const result = await this.pool.query<AccountUser>(
        'INSERT INTO account_users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
        [email, passwordHash],
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
      'SELECT id, email, password_hash AS "passwordHash" FROM account_users WHERE email = $1', [email],
    );
    return result.rows[0] ?? null;
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.ensureSchema();
    await this.pool.query('INSERT INTO account_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [userId, tokenHash, expiresAt]);
  }

  async findSession(tokenHash: string): Promise<AccountUser | null> {
    await this.ensureSchema();
    const result = await this.pool.query<AccountUser>(
      `SELECT users.id, users.email FROM account_sessions sessions
       JOIN account_users users ON users.id = sessions.user_id
       WHERE sessions.token_hash = $1 AND sessions.expires_at > now()`, [tokenHash],
    );
    return result.rows[0] ?? null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.ensureSchema();
    await this.pool.query('DELETE FROM account_sessions WHERE token_hash = $1', [tokenHash]);
  }

  async onModuleDestroy() { await this.pool.end(); }

  private ensureSchema(): Promise<void> {
    this.schemaReady ??= this.pool.query(`
      CREATE TABLE IF NOT EXISTS account_users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email varchar(254) NOT NULL UNIQUE,
        password_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS account_sessions (
        token_hash char(64) PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS account_sessions_user_id_idx ON account_sessions(user_id);
    `).then(() => undefined);
    return this.schemaReady;
  }
}
