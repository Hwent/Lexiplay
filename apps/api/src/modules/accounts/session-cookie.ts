import { UnauthorizedException } from '@nestjs/common';

export function readSessionCookie(cookieHeader: string | undefined) {
  const cookie = cookieHeader?.split(';').map(item => item.trim()).find(item => item.startsWith('lexiplay_session='));
  const token = cookie?.slice('lexiplay_session='.length);
  if (!token || !/^[a-zA-Z0-9_-]{40,50}$/.test(token)) throw new UnauthorizedException();
  return token;
}
