import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';

@Injectable()
export class FeedbackRepository implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgresql://lexiplay:lexiplay@127.0.0.1:5432/lexiplay' });

  async create(content: string, userId: string | undefined, guestHash: string | undefined) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      let guestId: string | undefined;
      let guestToken: string | undefined;
      if (!userId) {
        if (guestHash) {
          guestId = (await client.query<{ id: string }>(`SELECT id FROM guest_sessions
            WHERE token_hash=$1 AND expires_at>now() AND claimed_at IS NULL FOR SHARE`, [guestHash])).rows[0]?.id;
        }
        if (!guestId) {
          guestToken = randomBytes(32).toString('base64url');
          const hash = createHash('sha256').update(guestToken).digest('hex');
          guestId = (await client.query<{ id: string }>(`INSERT INTO guest_sessions(token_hash,expires_at)
            VALUES($1,now()+interval '30 days') RETURNING id`, [hash])).rows[0]!.id;
        }
      }
      const message = (await client.query<{ id: string; createdAt: Date }>(`INSERT INTO message(user_id,guest_session_id,content)
        VALUES($1,$2,$3) RETURNING id,created_at AS "createdAt"`, [userId ?? null, guestId ?? null, content])).rows[0]!;
      await client.query('COMMIT');
      return { ...message, guestToken };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async onModuleDestroy() { await this.pool.end(); }
}
