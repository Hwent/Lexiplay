import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccountRepository } from './account.repository';

@Controller('community')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { ttl: 60_000, limit: 60 } })
export class CommunityController {
  constructor(@Inject(AccountRepository) private readonly accounts: AccountRepository) {}

  @Get('coin-rankings')
  rankings() { return this.accounts.coinRankings(); }

  @Get('practice-rankings')
  practiceRankings() { return this.accounts.activityRankings('practice'); }

  @Get('streak-rankings')
  streakRankings() { return this.accounts.activityRankings('streak'); }
}
