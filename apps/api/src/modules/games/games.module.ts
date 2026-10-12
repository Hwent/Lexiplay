import { Module } from '@nestjs/common';
import { GameController } from './game.controller';
import { GameService } from './game.service';
import { WordListsModule } from '../word-lists/word-lists.module';
import { AccountsModule } from '../accounts/accounts.module';
import { GameRepository } from './game.repository';
import { StatisticsController } from './statistics.controller';
import { ProgressTransferController } from './progress-transfer.controller';
import { ProgressTransferRepository } from './progress-transfer.repository';

@Module({ imports: [WordListsModule, AccountsModule], controllers: [GameController, StatisticsController, ProgressTransferController], providers: [GameService, GameRepository, ProgressTransferRepository] })
export class GamesModule {}
