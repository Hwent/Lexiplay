import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { AccountCredentialsDto } from './account.dto';
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
  constructor(@Inject(AccountRepository) private readonly accounts: AccountRepository) {}

  async register(credentials: AccountCredentialsDto) {
    const email = credentials.email.trim().toLowerCase();
    const passwordHash = await this.hashPassword(credentials.password);
    const user = await this.accounts.createUser(email, passwordHash);
    if (!user) throw new ConflictException({ code: 'ACCOUNT_UNAVAILABLE', message: 'An account with this email already exists.' });
    return { user, token: await this.startSession(user.id) };
  }

  async login(credentials: AccountCredentialsDto) {
    const account = await this.accounts.findUser(credentials.email.trim().toLowerCase());
    if (!account || !(await this.verifyPassword(credentials.password, account.passwordHash))) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' });
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
