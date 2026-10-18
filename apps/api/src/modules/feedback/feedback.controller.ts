import { Body, Controller, Headers, Inject, Post, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccountService } from '../accounts/account.service';
import { readSessionCookie } from '../accounts/session-cookie';
import { guestOwner } from '../games/guest-cookie';
import { FeedbackDto } from './feedback.dto';
import { FeedbackRepository } from './feedback.repository';

@Controller('feedback')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { ttl: 60_000, limit: 5 } })
export class FeedbackController {
  constructor(@Inject(AccountService) private readonly accounts: AccountService,
    @Inject(FeedbackRepository) private readonly feedback: FeedbackRepository) {}

  @Post()
  async submit(@Body() body: FeedbackDto, @Headers('cookie') cookie: string | undefined,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void }) {
    let userId: string | undefined;
    if (/(?:^|;\s*)lexiplay_session=/.test(cookie ?? '')) {
      try { userId = (await this.accounts.current(readSessionCookie(cookie))).id; }
      catch (error) { if (!(error instanceof UnauthorizedException)) throw error; }
    }
    const { id, createdAt, guestToken } = await this.feedback.create(body.content, userId, guestOwner(cookie)?.slice(6));
    if (guestToken) response.setHeader('Set-Cookie', `lexiplay_guest=${guestToken}; HttpOnly; SameSite=Lax; Path=/api/v1; Max-Age=2592000${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    return { id, createdAt };
  }
}
