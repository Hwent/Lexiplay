import { Body, Controller, ForbiddenException, Headers, Inject, Post, Res, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccountService } from '../accounts/account.service';
import { readSessionCookie } from '../accounts/session-cookie';
import { WordEntry } from '../word-lists/word-list.repository';
import { guestOwner, expiredGuestCookie } from './guest-cookie';
import { ProgressTransferDto } from './progress-transfer.dto';
import { ProgressTransferRepository } from './progress-transfer.repository';

@Controller('progress')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { ttl: 60_000, limit: 60 } })
export class ProgressTransferController {
  constructor(@Inject(AccountService) private readonly accounts: AccountService, @Inject(ProgressTransferRepository) private readonly transfers: ProgressTransferRepository) {}
  @Post('claim')
  async claim(@Headers('cookie') cookie: string | undefined, @Body() body: ProgressTransferDto, @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void }) {
    const user = await this.accounts.current(readSessionCookie(cookie));
    if (user.id !== body.accountId) throw new ForbiddenException('Your signed-in account changed. Sign in again to save this progress.');
    const normalized = new Map<string, Omit<WordEntry, 'id'>>();
    for (const word of body.words) {
      const term = word.term.trim();
      if (!normalized.has(term)) normalized.set(term, { term, definition: '', partOfSpeech: word.partOfSpeech?.trim() || null, status: word.status });
    }
    const { guestClaimed, ...result } = await this.transfers.transfer(user.id, body.transferId, [...normalized.values()], guestOwner(cookie), body.lastGameId);
    if (guestClaimed) response.setHeader('Set-Cookie', expiredGuestCookie());
    return result;
  }
}
