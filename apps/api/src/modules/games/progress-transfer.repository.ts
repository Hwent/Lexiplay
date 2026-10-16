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
    await Promise.all([this.words.prepareProgressTransfer(), this.games.prepareProgressTransfer()]);
    const payloadHash = createHash('sha256').update(JSON.stringify(words)).digest('hex');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize retries and ownership changes before touching any account data.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`transfer:${id}`]);
      const user = await client.query('SELECT id FROM account_users WHERE id = $1 FOR UPDATE', [userId]);
      if (!user.rowCount) throw new NotFoundException('This account no longer exists.');
      const receipt = await client.query<{ user_id: string; payload_hash: string; result: TransferCounts }>('SELECT user_id, payload_hash, result FROM progress_transfers WHERE id = $1', [id]);
      const saved = receipt.rows[0];
      if (saved && (saved.user_id !== userId || saved.payload_hash !== payloadHash)) throw new ConflictException('This progress transfer belongs to a different account or has changed.');
      let result: TransferCounts;
      if (saved) result = saved.result;
      else {
        if (guest) {
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [guest]);
          const claimed = await client.query<{ user_id: string }>('SELECT user_id FROM guest_progress_claims WHERE guest_owner = $1', [guest]);
          if (claimed.rows[0] && claimed.rows[0].user_id !== userId) throw new ConflictException('This guest progress has already been saved to another account.');
          await client.query('INSERT INTO guest_progress_claims (guest_owner, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [guest, userId]);
        }
        const merged = await this.words.mergeGuestWords(client, userId, words);
        const gamesTransferred = guest ? await this.games.transferGuestGames(client, guest, `user:${userId}`) : 0;
        result = { ...merged, gamesTransferred };
        await client.query('INSERT INTO progress_transfers (id, user_id, payload_hash, result) VALUES ($1, $2, $3, $4)', [id, userId, payloadHash, JSON.stringify(result)]);
      }
      const resume = lastGameId ? await client.query<{ id: string }>('SELECT id FROM practice_games WHERE id = $1 AND owner_key = $2', [lastGameId, `user:${userId}`]) : undefined;
      const currentGuest = guest ? await client.query('SELECT user_id FROM guest_progress_claims WHERE guest_owner = $1 AND user_id = $2', [guest, userId]) : undefined;
      await client.query('COMMIT');
      return { ...result, resumeGameId: resume?.rows[0]?.id ?? null, guestClaimed: Boolean(currentGuest?.rowCount) };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async onModuleDestroy() { await this.pool.end(); }
}
