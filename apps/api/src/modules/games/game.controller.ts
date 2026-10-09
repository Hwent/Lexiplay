import { Body, Controller, Headers, Inject, Param, Post } from '@nestjs/common';
import { GameService } from './game.service';
import { SubmitGuessDto } from './submit-guess.dto';
import { WordListsService } from '../word-lists/word-lists.service';
import { readSessionCookie } from '../accounts/session-cookie';

@Controller('games')
export class GameController {
  constructor(@Inject(GameService) private readonly games: GameService, @Inject(WordListsService) private readonly wordLists: WordListsService) {}

  @Post()
  async start(@Headers('cookie') cookie: string | undefined, @Body() body: { wordLength?: unknown; playWithMyWords?: unknown }) {
    const length = body?.wordLength;
    const words = body?.playWithMyWords === true
      ? await this.wordLists.playableWords(readSessionCookie(cookie), typeof length === 'number' ? length : 5)
      : undefined;
    return this.games.start(length, words);
  }

  @Post(':gameId/guesses')
  submit(@Param('gameId') gameId: string, @Body() body: SubmitGuessDto) {
    return this.games.submit(gameId, body.guess);
  }
}
