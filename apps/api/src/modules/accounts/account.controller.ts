import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Inject, Post, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccountCredentialsDto, RegisterAccountDto, RecoveryDto, ActionTokenDto, ResetPasswordDto, AddEmailDto, DeleteAccountDto } from './account.dto';
import { AccountService } from './account.service';
import { readSessionCookie } from './session-cookie';

type Response = { setHeader(name: string, value: string): void };

@Controller('auth')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { ttl: 60_000, limit: 10 } })
export class AccountController {
  constructor(@Inject(AccountService) private readonly accounts: AccountService) {}

  @Post('register')
  async register(@Body() credentials: RegisterAccountDto, @Res({ passthrough: true }) response: Response) {
    const session = await this.accounts.register(credentials);
    response.setHeader('Set-Cookie', this.accounts.cookie(session.token));
    return { user: session.user, verificationSent: session.verificationSent };
  }

  @Post('login')
  async login(@Body() credentials: AccountCredentialsDto, @Res({ passthrough: true }) response: Response) {
    const session = await this.accounts.login(credentials);
    response.setHeader('Set-Cookie', this.accounts.cookie(session.token));
    return { user: session.user };
  }

  @Get('me')
  async current(@Headers('cookie') cookieHeader: string | undefined, @Res({ passthrough: true }) response: Response) {
    try { return await this.accounts.current(readSessionCookie(cookieHeader)); }
    catch (error) {
      if (error instanceof UnauthorizedException) response.setHeader('Set-Cookie', this.accounts.expiredCookie());
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Headers('cookie') cookieHeader: string | undefined, @Res({ passthrough: true }) response: Response) {
    const token = readSessionCookie(cookieHeader);
    await this.accounts.logout(token);
    response.setHeader('Set-Cookie', this.accounts.expiredCookie());
  }

  @Post('forgot-password')
  forgot(@Body() body: RecoveryDto) { return this.accounts.requestReset(body.email); }
  @Post('reset-password')
  reset(@Body() body: ResetPasswordDto) { return this.accounts.resetPassword(body.token, body.password); }
  @Post('verification-request')
  requestVerification(@Headers('cookie') cookie: string | undefined) { return this.accounts.requestVerification(readSessionCookie(cookie)); }
  @Post('verify-email')
  verify(@Body() body: ActionTokenDto) { return this.accounts.verifyEmail(body.token); }

  @Post('email')
  addEmail(@Headers('cookie') cookie: string | undefined, @Body() body: AddEmailDto) { return this.accounts.addEmail(readSessionCookie(cookie), body.email, body.password); }

  @Delete('account')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAccount(@Headers('cookie') cookie: string | undefined, @Body() body: DeleteAccountDto, @Res({ passthrough: true }) response: Response) {
    await this.accounts.deleteAccount(readSessionCookie(cookie), body.password);
    response.setHeader('Set-Cookie', this.accounts.expiredCookie());
  }

}
