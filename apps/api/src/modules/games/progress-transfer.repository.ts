import { ConflictException, Inject, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { WordEntry, WordListRepository } from '../word-lists/word-list.repository';
import { GameRepository } from './game.repository';

type TransferCounts = { wordsAdded: number; wordsAlreadySaved: number; gamesTransferred: number };
@Injectable()
export class ProgressTransferRepository implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgresql://lexiplay:lexiplay@127.0.0.1:5432/lexiplay' });
  constructor(@Inject(WordListRepository) private readonly words: WordListRepository, @Inject(GameRepository) private readonly games: GameRepository) {}

  async transfer(userId: string, id: string, words: Omit<WordEntry, 'id'>[], guest?: string, lastGameId?: string) {
    const payloadHash = createHash('sha256').update(JSON.stringify(words)).digest('hex');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('library-publication',0))");
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['transfer:' + id]);
      const user = await client.query('SELECT id FROM account_users WHERE id=$1 FOR UPDATE', [userId]);
      if (!user.rowCount) throw new NotFoundException('This account no longer exists.');
      const receipt = (await client.query<{ user_id: string; payload_hash: string; result: TransferCounts }>('SELECT user_id,payload_hash,result FROM progress_transfers WHERE id=$1', [id])).rows[0];
      if (receipt && (receipt.user_id !== userId || receipt.payload_hash !== payloadHash)) throw new ConflictException('This progress transfer belongs to a different account or has changed.');
      let guestId: string | null = null;
      if (guest) {
        const session = (await client.query<{ id: string; claimed_at: Date | null; claimed_by_user_id: string | null; expires_at: Date }>(
          'SELECT id,claimed_at,claimed_by_user_id,expires_at FROM guest_sessions WHERE token_hash=$1 FOR UPDATE', [guest.slice(6)])).rows[0];
        if (session) {
          if ((session.claimed_at && session.claimed_by_user_id !== userId) || session.expires_at <= new Date()) throw new ConflictException('This guest session is no longer available for transfer.');
          guestId = session.id;
          await client.query('UPDATE guest_sessions SET claimed_at=COALESCE(claimed_at,now()),claimed_by_user_id=$2 WHERE id=$1', [guestId, userId]);
        }
      }
      let result: TransferCounts;
      if (receipt) result = receipt.result;
      else {
        const merged = await this.words.mergeGuestWords(client, userId, words);
        const gamesTransferred = guestId && guest ? await this.games.transferGuestGames(client, guest, 'user:' + userId) : 0;
        result = { ...merged, gamesTransferred };
        await client.query('INSERT INTO progress_transfers(id,user_id,guest_session_id,payload_hash,result) VALUES($1,$2,$3,$4,$5)',
          [id, userId, guestId, payloadHash, JSON.stringify(result)]);
      }
      const resume = lastGameId ? (await client.query<{ id: string }>('SELECT id FROM practice_games WHERE id=$1 AND user_id=$2', [lastGameId, userId])).rows[0] : undefined;
      await client.query('COMMIT');
      return { ...result, resumeGameId: resume?.id ?? null, guestClaimed: !!guestId };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async onModuleDestroy() { await this.pool.end(); }
}
