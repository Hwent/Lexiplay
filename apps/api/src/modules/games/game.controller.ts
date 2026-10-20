import { CollectionsService } from '../collections/collections.service';
import { BadRequestException, Body, Controller, Get, Headers, Inject, Param, ParseUUIDPipe, Post, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { randomBytes } from 'node:crypto';
import { GameService } from './game.service';
import { GameRepository } from './game.repository';
import { SubmitGuessDto } from './submit-guess.dto';
import { StartGameDto, HintDto } from './game.dto';
import { AccountService } from '../accounts/account.service';
import { readSessionCookie } from '../accounts/session-cookie';
import { guestOwner } from './guest-cookie';

type Response = { setHeader(name: string, value: string): void };
@Controller('games')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { ttl: 60_000, limit: 60 } })
export class GameController {
  constructor(@Inject(CollectionsService) private readonly collections: CollectionsService,
    @Inject(GameService) private readonly games: GameService, @Inject(GameRepository) private readonly repository: GameRepository,
    @Inject(AccountService) private readonly accounts: AccountService) {}

  @Get('wallet')
  async wallet(@Headers('cookie') cookie: string | undefined, @Res({ passthrough: true }) response: Response) {
    return this.repository.wallet(await this.owner(cookie, response));
  }

  @Post()
  async start(@Headers('cookie') cookie: string | undefined, @Body() body: StartGameDto, @Res({ passthrough: true }) response: Response) {
    if (body.kind === 'word-ladder') {
      if (body.collectionId || body.wordListId || body.playWithMyWords || body.difficulty && body.difficulty !== 'medium') {
        throw new BadRequestException('Word Ladder uses its own common-word pool and a fixed five-coin reward.');
      }
      return this.games.startLadder(body.wordLength ?? 5, await this.owner(cookie, response), body.startRequestId);
    }
    if (body.kind === 'wordle' && ((body.wordLength !== undefined && body.wordLength !== 5) || body.collectionId || body.wordListId || body.playWithMyWords)) {
      throw new BadRequestException('Original Wordle uses its own five-letter answer collection.');
    }
    if (body.collectionId && (body.playWithMyWords || body.wordListId)) throw new BadRequestException('Choose either a collection or your saved words.');
    const owner = await this.owner(cookie, response);
    const length = body.wordLength ?? 5, token = owner.startsWith('user:') ? readSessionCookie(cookie) : undefined;
    const selected = body.kind === 'wordle' ? await this.collections.wordleGameWords()
      : body.collectionId ? await this.collections.collectionGameWords(body.collectionId, length) : undefined;
    const personal = body.wordListId ?? (body.playWithMyWords ? (await this.accounts.current(token)).id : undefined);
    const words = personal ? await this.collections.gameWords(token, personal, length) : selected?.words;
    const collection = selected ? { id: selected.collection.id, name: selected.collection.name, author: selected.collection.author ?? '' } : undefined;
    return this.games.start(length, words, body.difficulty ?? 'medium', owner, collection, body.startRequestId);
  }

  @Get(':gameId')
  async read(@Headers('cookie') cookie: string | undefined, @Param('gameId', new ParseUUIDPipe()) id: string) { return this.games.read(id, await this.owner(cookie)); }
  @Post(':gameId/guesses')
  async submit(@Headers('cookie') cookie: string | undefined, @Param('gameId', new ParseUUIDPipe()) id: string, @Body() body: SubmitGuessDto) { return this.games.submit(id, body.guess, await this.owner(cookie)); }
  @Post(':gameId/hints')
  async hint(@Headers('cookie') cookie: string | undefined, @Param('gameId', new ParseUUIDPipe()) id: string, @Body() body: HintDto) { return this.games.hint(id, body.type, await this.owner(cookie)); }

  @Post(':gameId/abandon')
  async abandon(@Headers('cookie') cookie: string | undefined, @Param('gameId', new ParseUUIDPipe()) id: string) {
    return this.games.abandon(id,await this.owner(cookie));
  }

  private async owner(cookie: string | undefined, response?: Response) {
    if (/(?:^|;\s*)lexiplay_session=/.test(cookie ?? '')) {
      try { return `user:${(await this.accounts.current(readSessionCookie(cookie))).id}`; }
      catch (error) {
        if (!(error instanceof UnauthorizedException)) throw error;
      }
    }
    let owner = guestOwner(cookie);
    if (!owner && response) {
      const guest = randomBytes(32).toString('base64url');
      response.setHeader('Set-Cookie', `lexiplay_guest=${guest}; HttpOnly; SameSite=Lax; Path=/api/v1; Max-Age=2592000${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
      owner = guestOwner(`lexiplay_guest=${guest}`);
    }
    return owner ?? 'guest:missing';
  }
}
