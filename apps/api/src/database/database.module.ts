import { Global, Injectable, Logger, Module, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';

function integerSetting(name: string, fallback: number, minimum: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${name} must be an integer >= ${minimum}.`);
  return value;
}

@Injectable()
export class DatabasePool extends Pool implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor() {
    super({
      connectionString: process.env.DATABASE_URL ?? 'postgresql://lexiplay:lexiplay@127.0.0.1:5432/lexiplay',
      max: integerSetting('DATABASE_POOL_MAX', 10, 2),
      min: 2,
      idleTimeoutMillis: integerSetting('DATABASE_POOL_IDLE_MS', 120_000, 1),
      connectionTimeoutMillis: 15_000,
    });
    this.on('error', () => Logger.error('An idle database connection failed.', 'DatabasePool'));
  }

  async onApplicationBootstrap() {
    if (process.env.NODE_ENV !== 'production') return;
    await Promise.all(Array.from({ length: 2 }, async () => {
      const client = await this.connect();
      client.release();
    }));
  }

  async onApplicationShutdown() { await this.end(); }
}

@Global()
@Module({ providers: [DatabasePool], exports: [DatabasePool] })
export class DatabaseModule {}
