import { BadRequestException, Inject, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { WordListRepository } from './word-list.repository';
import { AccountService } from '../accounts/account.service';
import { CEFR_POOLS, CefrPool, poolSummary, resolvePoolWord } from './cefr-pools';

@Injectable()
export class CefrPoolsService implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgresql://lexiplay:lexiplay@127.0.0.1:5432/lexiplay' });
  private ready?: Promise<void>;
  constructor(@Inject(AccountService) private readonly accounts: AccountService, @Inject(WordListRepository) private readonly dictionary: WordListRepository) {}
  private ensureSchema() {
    this.ready ??= (async () => {
      await this.pool.query(`CREATE TABLE IF NOT EXISTS game_word_pools (
        id text PRIMARY KEY, name text NOT NULL, cefr_level text NOT NULL, author text NOT NULL, words jsonb NOT NULL
      );`);
      for (const pool of CEFR_POOLS) await this.pool.query(`INSERT INTO game_word_pools (id,name,cefr_level,author,words) VALUES ($1,$2,$3,$4,$5::jsonb)
        ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,cefr_level=EXCLUDED.cefr_level,author=EXCLUDED.author,words=EXCLUDED.words`,
      [pool.id, pool.name, pool.level, pool.author, JSON.stringify(pool.words)]);
    })();
    return this.ready;
  }
  private async ensureMembership() {
    await this.ensureSchema();
    await this.pool.query(`CREATE TABLE IF NOT EXISTS user_game_pools (
      owner_id uuid NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
      pool_id text NOT NULL REFERENCES game_word_pools(id) ON DELETE CASCADE,
      added_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,pool_id)
    )`);
  }
  private source(id: string): CefrPool {
    const pool = CEFR_POOLS.find(pool => pool.id === id);
    if (!pool) throw new NotFoundException('Word list not found.');
    return pool;
  }
  async catalog() { await this.ensureSchema(); return CEFR_POOLS.map(poolSummary); }
  async added(cookie: string | undefined) {
    const user = await this.accounts.current(cookie);
    await this.ensureMembership();
    const { rows } = await this.pool.query<{ pool_id: string }>(`SELECT pool_id FROM user_game_pools WHERE owner_id=$1 UNION SELECT g.id AS pool_id FROM user_vocabulary_collections u JOIN vocabulary_collections c ON c.id=u.collection_id JOIN game_word_pools g ON g.cefr_level=c.level WHERE u.user_id=$1 AND c.category='CEFR' AND c.status='available'`, [user.id]);
    return rows.map(row => poolSummary(this.source(row.pool_id)));
  }
  async add(cookie: string | undefined, id: string) {
    const user = await this.accounts.current(cookie);
    this.source(id); await this.ensureMembership();
    await this.pool.query('INSERT INTO user_game_pools(owner_id,pool_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [user.id, id]);
    return this.details(id);
  }
  async details(id: string) {
    const source = this.source(id);
    // The pool stores only terms and source parts of speech. Dictionary content is resolved on demand.
    const rows = await this.dictionary.poolDictionaryEntries(source.words.map(word => word.term));
    const dictionary = new Map(rows.map(row => [row.term, row]));
    const words = source.words.map(word => resolvePoolWord(word, dictionary.get(word.term)));
    let availableCount = 0;
    const wordCounts: Record<number, number> = { 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
    for (const word of words) {
      if (!word.available) continue;
      availableCount++;
      if (/^[a-z]{3,9}$/.test(word.term)) wordCounts[word.term.length]!++;
    }
    return { ...poolSummary(source), words, availableCount, wordCounts };
  }
  async gameWords(id: string, length: number) {
    const details = await this.details(id);
    const words = details.words.filter(word => word.available && /^[a-z]+$/.test(word.term) && word.term.length === length).map(word => word.term);
    if (!words.length) throw new BadRequestException('This list has no dictionary-backed words at that length. Choose another word length.');
    return words;
  }
  summary(id: string) { return poolSummary(this.source(id)); }
  async onModuleDestroy() { await this.pool.end(); }
}
