import { createHash } from 'node:crypto';

export function guestOwner(cookie: string | undefined): string | undefined {
  const token = cookie?.match(/(?:^|;\s*)lexiplay_guest=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1];
  return token ? `guest:${createHash('sha256').update(token).digest('hex')}` : undefined;
}
export function expiredGuestCookie() {
  return `lexiplay_guest=; HttpOnly; SameSite=Lax; Path=/api/v1; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
