import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AccountsModule } from '../accounts/accounts.module';
import { WordListRepository } from './word-list.repository';
import { WordListsController } from './word-lists.controller';
import { WordListsService } from './word-lists.service';
import { WordListImportService } from './word-list-import';

@Module({
  imports: [AccountsModule, ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }])],
  controllers: [WordListsController],
  providers: [WordListRepository, WordListsService, WordListImportService],
})
export class WordListsModule {}
