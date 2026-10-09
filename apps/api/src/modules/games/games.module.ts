import { Module } from '@nestjs/common';
import { GameController } from './game.controller';
import { GameService } from './game.service';
import { WordListsModule } from '../word-lists/word-lists.module';

@Module({ imports: [WordListsModule], controllers: [GameController], providers: [GameService] })
export class GamesModule {}
