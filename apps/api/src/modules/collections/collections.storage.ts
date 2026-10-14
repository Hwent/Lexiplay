import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
@Injectable()
export class CollectionsStorage extends PrismaClient implements OnModuleDestroy {
  constructor() { super({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? 'postgresql://lexiplay:lexiplay@127.0.0.1:5432/lexiplay' }) }); }
  async onModuleDestroy() { await this.$disconnect(); }
}
