import { BadRequestException, Controller, Get, Headers, Inject, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccountService } from '../accounts/account.service';
import { readSessionCookie } from '../accounts/session-cookie';
import { GameRepository } from './game.repository';
import { Game, publicGame } from './game.types';

@Controller('progress')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { ttl: 60_000, limit: 60 } })
export class StatisticsController {
  constructor(@Inject(AccountService) private readonly accounts: AccountService, @Inject(GameRepository) private readonly games: GameRepository) {}
  @Get('summary')
  async summary(@Headers('cookie') cookie: string | undefined, @Query('timezone') timezone = 'UTC') {
    const user = await this.accounts.current(readSessionCookie(cookie));
    try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); } catch { throw new BadRequestException('Choose a valid timezone.'); }
    return statistics(await this.games.history(`user:${user.id}`), timezone);
  }
}

export function statistics(games: Game[], timezone: string, now = new Date()) {
  const day = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const days = new Set(games.map(game => day(new Date(game.completedAt!))));
  const cursor = new Date(`${day(now)}T12:00:00Z`);
  const calendarDay = () => cursor.toISOString().slice(0, 10);
  if (!days.has(calendarDay())) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while (days.has(calendarDay())) { streak++; cursor.setUTCDate(cursor.getUTCDate() - 1); }
  const won = games.filter(game => game.guesses.at(-1)?.outcome === 'WON');
  return {
    timezone, total: games.length, wins: won.length, losses: games.length - won.length,
    winRate: games.length ? Math.round(won.length / games.length * 100) : 0, streak,
    distribution: Array.from({ length: 7 }, (_, i) => ({ attempts: i + 1, wins: won.filter(game => game.guesses.length === i + 1).length })),
    recent: games.slice(0, 20).map(publicGame),
  };
}
