import { BadRequestException, ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { AccountCredentialsDto, RegisterAccountDto } from './account.dto';
import { AccountMailService } from './account-mail.service';
import { AccountRepository, AccountUser } from './account.repository';

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;
const deriveKey = (password: string, salt: Buffer, length: number) => new Promise<Buffer>((resolve, reject) => {
  scryptCallback(password, salt, length, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
    if (error) reject(error);
    else resolve(key as Buffer);
  });
});

@Injectable()
export class AccountService {
  constructor(@Inject(AccountRepository) private readonly accounts: AccountRepository, @Inject(AccountMailService) private readonly mail: AccountMailService) {}

  async register(credentials: RegisterAccountDto) {
    const email = credentials.email?.trim().toLowerCase() || null;
    if (credentials.sendVerification && !email) throw new BadRequestException('Add an email address to request verification.');
    const passwordHash = await this.hashPassword(credentials.password);
    const user = await this.accounts.createUser(email, passwordHash, credentials.username.trim().toLowerCase());
    if (!user) throw new ConflictException({ code: 'ACCOUNT_UNAVAILABLE', message: 'That email or username is already in use.' });
    let verificationSent = false;
    if (credentials.sendVerification) {
      try { await this.sendAction(user, 'verify'); verificationSent = true; } catch { /* Verification is optional and can be retried later. */ }
    }
    return { user, token: await this.startSession(user.id), verificationSent };
  }

  async login(credentials: AccountCredentialsDto) {
    const identifier = credentials.identifier ?? credentials.email;
    if (!identifier?.trim()) throw new BadRequestException('Enter your username or email.');
    const account = await this.accounts.findUser(identifier.trim().toLowerCase());
    if (!account || !(await this.verifyPassword(credentials.password, account.passwordHash))) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Username, email, or password is incorrect.' });
    }
    const { passwordHash: _passwordHash, ...user } = account;
    return { user, token: await this.startSession(user.id) };
  }

  async current(token: string | undefined): Promise<AccountUser> {
    if (!token) throw new UnauthorizedException();
    const user = await this.accounts.findSession(this.hashToken(token));
    if (!user) throw new UnauthorizedException();
    return user;
  }

  async logout(token: string | undefined) {
    if (token) await this.accounts.deleteSession(this.hashToken(token));
  }

  async addEmail(session: string | undefined, email: string, password: string) {
    const user = await this.current(session);
    const record = await this.requirePassword(user.id, password);
    if (record.email) throw new ConflictException('Your account already has a recovery email.');
    try {
      const updated = await this.accounts.addEmail(user.id, email.trim().toLowerCase(), record.passwordHash);
      if (!updated) throw new ConflictException('Your account changed. Refresh and try again.');
      return { user: updated };
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('That email is already in use.');
      throw error;
    }
  }

  async deleteAccount(session: string | undefined, password: string) {
    const user = await this.current(session);
    const record = await this.requirePassword(user.id, password);
    if (!await this.accounts.deleteAccount(user.id, record.passwordHash)) throw new ConflictException('Your account changed. Sign in again before deleting it.');
  }

  async updateUsername(session: string | undefined, username: string) {
    const user = await this.current(session);
    try {
      const updated = await this.accounts.updateUsername(user.id, username.trim().toLowerCase());
      if (!updated) throw new UnauthorizedException();
      return { user: updated };
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('That username is already in use.');
      throw error;
    }
  }

  private async requirePassword(id: string, password: string) {
    const record = await this.accounts.findById(id);
    if (!record || !await this.verifyPassword(password, record.passwordHash)) throw new UnauthorizedException('Your current password is incorrect.');
    return record;
  }

  async requestReset(email: string) {
    const user = await this.accounts.findUser(email.trim().toLowerCase());
    if (user?.email) {
      try { await this.sendAction(user, 'reset'); } catch { /* Preserve the same response for existing and unknown addresses. */ }
    }
    return { message: 'If that email has an account, a reset link will arrive shortly.' };
  }

  async requestVerification(session: string | undefined) {
    const user = await this.current(session);
    if (!user.email) throw new BadRequestException('Add a recovery email before requesting verification.');
    if (!user.emailVerified) await this.sendAction(user, 'verify');
    return { message: user.emailVerified ? 'Your email is already verified.' : 'Verification link requested. Check your email.' };
  }

  async verifyEmail(token: string) {
    if (!await this.accounts.consumeAction(this.hashToken(token), 'verify')) throw new BadRequestException('This link is invalid or expired. Request a new one.');
    return { message: 'Your email is verified.' };
  }

  async resetPassword(token: string, password: string) {
    if (!await this.accounts.consumeAction(this.hashToken(token), 'reset', await this.hashPassword(password))) throw new BadRequestException('This link is invalid or expired. Request a new one.');
    return { message: 'Password updated. Sign in with your new password.' };
  }

  private async sendAction(user: AccountUser, purpose: 'reset' | 'verify') {
    if (!user.email) throw new BadRequestException('Add an email address first.');
    const token = randomBytes(32).toString('base64url');
    await this.accounts.createAction(user.id, this.hashToken(token), purpose, new Date(Date.now() + (purpose === 'reset' ? 30 * 60_000 : 24 * 60 * 60_000)));
    await this.mail.send(user.email, purpose, token);
  }

  cookie(token: string, secure = process.env.NODE_ENV === 'production') {
    return `lexiplay_session=${token}; HttpOnly; SameSite=Lax; Path=/api/v1; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure ? '; Secure' : ''}`;
  }

  expiredCookie(secure = process.env.NODE_ENV === 'production') {
    return `lexiplay_session=; HttpOnly; SameSite=Lax; Path=/api/v1; Max-Age=0${secure ? '; Secure' : ''}`;
  }

  private async startSession(userId: string) {
    const token = randomBytes(32).toString('base64url');
    await this.accounts.createSession(userId, this.hashToken(token), new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000));
    return token;
  }

  private hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }

  private async hashPassword(password: string) {
    const salt = randomBytes(16);
    const hash = await deriveKey(password, salt, 64);
    return `scrypt$32768$8$1$${salt.toString('base64url')}$${hash.toString('base64url')}`;
  }

  private async verifyPassword(password: string, encoded: string) {
    const [, cost, blockSize, parallelization, saltValue, hashValue] = encoded.split('$');
    if (cost !== '32768' || blockSize !== '8' || parallelization !== '1' || !saltValue || !hashValue) return false;
    const salt = Buffer.from(saltValue, 'base64url');
    const expected = Buffer.from(hashValue, 'base64url');
    const actual = await deriveKey(password, salt, expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
