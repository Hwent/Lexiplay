import { Module } from '@nestjs/common';
import { GameController } from './game.controller';
import { GameService } from './game.service';
import { WordListsModule } from '../word-lists/word-lists.module';
import { AccountsModule } from '../accounts/accounts.module';
import { GameRepository } from './game.repository';
import { StatisticsController } from './statistics.controller';

@Module({ imports: [WordListsModule, AccountsModule], controllers: [GameController, StatisticsController], providers: [GameService, GameRepository] })
export class GamesModule {}
