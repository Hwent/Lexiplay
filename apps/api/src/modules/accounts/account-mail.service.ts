import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { accountEmail } from './account-email';

@Injectable()
export class AccountMailService {
  async send(email: string, purpose: 'reset' | 'verify', token: string) {
    const origin = process.env.PUBLIC_WEB_ORIGIN;
    if (!origin) throw new ServiceUnavailableException('Account email needs PUBLIC_WEB_ORIGIN configuration.');
    let url: URL;
    try { url = new URL('/account', origin); } catch { throw new ServiceUnavailableException('Account email needs a valid web origin.'); }
    if (!['http:', 'https:'].includes(url.protocol) || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) throw new ServiceUnavailableException('Account email needs a valid web origin.');
    url.hash = new URLSearchParams({ action: purpose, token }).toString();
    const message = {
      to: [email], from: process.env.MAIL_FROM ?? 'LexiPlay <onboarding@resend.dev>',
      ...accountEmail(purpose, url.href),
    };
    const mode = process.env.MAIL_MODE ?? (process.env.NODE_ENV === 'production' ? 'resend' : 'local');
    if (mode === 'local' && process.env.NODE_ENV !== 'production') {
      const directory = join(process.cwd(), '.local-mail');
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, `${randomUUID()}.json`), JSON.stringify(message, null, 2), { mode: 0o600 });
      return;
    }
    if (mode !== 'resend' || !process.env.RESEND_API_KEY || !process.env.MAIL_FROM) throw new ServiceUnavailableException('Account email delivery is not configured.');
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify(message), signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error('Provider rejected email.');
    } catch { throw new ServiceUnavailableException('Email delivery failed. Please try again later.'); }
  }
}
