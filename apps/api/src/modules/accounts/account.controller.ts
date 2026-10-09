import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Inject, Post, Res, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AccountCredentialsDto } from './account.dto';
import { AccountService } from './account.service';
import { readSessionCookie } from './session-cookie';

type Response = { setHeader(name: string, value: string): void };

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AccountController {
  constructor(@Inject(AccountService) private readonly accounts: AccountService) {}

  @Post('register')
  async register(@Body() credentials: AccountCredentialsDto, @Res({ passthrough: true }) response: Response) {
    const session = await this.accounts.register(credentials);
    response.setHeader('Set-Cookie', this.accounts.cookie(session.token));
    return { user: session.user };
  }

  @Post('login')
  async login(@Body() credentials: AccountCredentialsDto, @Res({ passthrough: true }) response: Response) {
    const session = await this.accounts.login(credentials);
    response.setHeader('Set-Cookie', this.accounts.cookie(session.token));
    return { user: session.user };
  }

  @Get('me')
  async current(@Headers('cookie') cookieHeader: string | undefined) {
    const user = await this.accounts.current(readSessionCookie(cookieHeader));
    return user;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Headers('cookie') cookieHeader: string | undefined, @Res({ passthrough: true }) response: Response) {
    const token = readSessionCookie(cookieHeader);
    await this.accounts.logout(token);
    response.setHeader('Set-Cookie', this.accounts.expiredCookie());
  }

}
