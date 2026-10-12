import { Body, Controller, Get, Headers, Inject, Param, ParseUUIDPipe, Post, Res, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { randomBytes } from 'node:crypto';
import { GameService } from './game.service';
import { SubmitGuessDto } from './submit-guess.dto';
import { StartGameDto, HintDto } from './game.dto';
import { WordListsService } from '../word-lists/word-lists.service';
import { AccountService } from '../accounts/account.service';
import { readSessionCookie } from '../accounts/session-cookie';
import { guestOwner } from './guest-cookie';

type Response = { setHeader(name: string, value: string): void };
@Controller('games')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { ttl: 60_000, limit: 60 } })
export class GameController {
  constructor(@Inject(GameService) private readonly games: GameService, @Inject(WordListsService) private readonly words: WordListsService, @Inject(AccountService) private readonly accounts: AccountService) {}

  @Post()
  async start(@Headers('cookie') cookie: string | undefined, @Body() body: StartGameDto, @Res({ passthrough: true }) response: Response) {
    const owner = await this.owner(cookie, response);
    const words = body.playWithMyWords ? await this.words.playableWords(readSessionCookie(cookie), body.wordLength ?? 5) : undefined;
    return this.games.start(body.wordLength ?? 5, words, body.difficulty ?? 'medium', owner);
  }
  @Get(':gameId')
  async read(@Headers('cookie') cookie: string | undefined, @Param('gameId', new ParseUUIDPipe()) id: string) { return this.games.read(id, await this.owner(cookie)); }
  @Post(':gameId/guesses')
  async submit(@Headers('cookie') cookie: string | undefined, @Param('gameId', new ParseUUIDPipe()) id: string, @Body() body: SubmitGuessDto) { return this.games.submit(id, body.guess, await this.owner(cookie)); }
  @Post(':gameId/hints')
  async hint(@Headers('cookie') cookie: string | undefined, @Param('gameId', new ParseUUIDPipe()) id: string, @Body() body: HintDto) { return this.games.hint(id, body.type, await this.owner(cookie)); }

  private async owner(cookie: string | undefined, response?: Response) {
    const session = /(?:^|;\s*)lexiplay_session=/.test(cookie ?? '') ? readSessionCookie(cookie) : undefined;
    if (session) return `user:${(await this.accounts.current(session)).id}`;
    let owner = guestOwner(cookie);
    if (!owner && response) {
      const guest = randomBytes(32).toString('base64url');
      response.setHeader('Set-Cookie', `lexiplay_guest=${guest}; HttpOnly; SameSite=Lax; Path=/api/v1; Max-Age=2592000${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
      owner = guestOwner(`lexiplay_guest=${guest}`);
    }
    return owner ?? 'guest:missing';
  }
}
