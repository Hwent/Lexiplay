import { CollectionsStorage } from '../collections/collections.storage';
import { CollectionsService } from '../collections/collections.service';
import { CollectionsController, PersonalCollectionsController } from '../collections/collections.controller';
import { CefrPoolsService } from './cefr-pools.service';
import { CefrPoolsController } from './cefr-pools.controller';
import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AccountsModule } from '../accounts/accounts.module';
import { WordListRepository } from './word-list.repository';
import { WordListsController } from './word-lists.controller';
import { WordListsService } from './word-lists.service';
import { WordListImportService } from './word-list-import';

@Module({
  imports: [AccountsModule, ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }])],
  controllers: [CollectionsController, PersonalCollectionsController, CefrPoolsController, WordListsController],
  providers: [CollectionsStorage, CollectionsService, CefrPoolsService, WordListRepository, WordListsService, WordListImportService],
  exports: [CollectionsService, CefrPoolsService, WordListsService, WordListRepository],
})
export class WordListsModule {}
