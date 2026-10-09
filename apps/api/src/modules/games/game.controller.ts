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
  async submit(@Param('gameId') gameId: string, @Body() body: SubmitGuessDto) {
    const result = this.games.submit(gameId, body.guess);
    const enriched = { ...result, definition: await this.wordLists.dictionaryDefinition(result.guess) };
    if (result.answer) return { ...enriched, answerDefinition: await this.wordLists.dictionaryDefinition(result.answer) };
    return enriched;
  }

  @Post(':gameId/hints')
  hint(@Param('gameId') gameId: string, @Body() body: { type?: unknown }) {
    return this.games.hint(gameId, body?.type);
  }
}
