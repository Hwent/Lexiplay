import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module';
import { GamesModule } from './modules/games/games.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { WordListsModule } from './modules/word-lists/word-lists.module';

@Module({ imports: [HealthModule, GamesModule, AccountsModule, WordListsModule] })
export class AppModule {}
