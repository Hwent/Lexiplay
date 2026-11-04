import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { DatabasePool } from '../../database/database.module';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
@Injectable()
export class CollectionsStorage extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(DatabasePool) pool: DatabasePool) { super({ adapter: new PrismaPg(pool) }); }
  async onModuleDestroy() { await this.$disconnect(); }
}
