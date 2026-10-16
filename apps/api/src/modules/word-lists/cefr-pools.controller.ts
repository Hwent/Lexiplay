import { ThrottlerGuard } from '@nestjs/throttler';
import { Controller, Get, Headers, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { readSessionCookie } from '../accounts/session-cookie';
import { CefrPoolsService } from './cefr-pools.service';
@Controller('word-lists/pools')
@UseGuards(ThrottlerGuard)
export class CefrPoolsController {
  constructor(@Inject(CefrPoolsService) private readonly pools: CefrPoolsService) {}
  @Get() catalog() { return this.pools.catalog(); }
  @Get('added') added(@Headers('cookie') cookie?: string) { return this.pools.added(readSessionCookie(cookie)); }
  @Post(':id') add(@Param('id') id: string, @Headers('cookie') cookie?: string) { return this.pools.add(readSessionCookie(cookie), id); }
  @Get(':id') details(@Param('id') id: string) { return this.pools.details(id); }
}
