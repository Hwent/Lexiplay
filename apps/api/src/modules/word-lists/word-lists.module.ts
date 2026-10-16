import { CollectionsStorage } from '../collections/collections.storage';
import { CollectionsService } from '../collections/collections.service';
import { CollectionsController, PersonalCollectionsController, LibraryController } from '../collections/collections.controller';
import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AccountsModule } from '../accounts/accounts.module';
import { WordListRepository } from './word-list.repository';
import { WordListsController } from './word-lists.controller';
import { WordListsService } from './word-lists.service';
import { WordListImportService } from './word-list-import';

@Module({
  imports: [AccountsModule, ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }])],
  controllers: [LibraryController, CollectionsController, PersonalCollectionsController, WordListsController],
  providers: [CollectionsStorage, CollectionsService, WordListRepository, WordListsService, WordListImportService],
  exports: [CollectionsService, WordListsService, WordListRepository],
})
export class WordListsModule {}
