import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountMailService } from './account-mail.service';

describe('configured account mail delivery', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it('sends the expected action link through the configured provider without returning its token', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('MAIL_MODE', 'resend');
    vi.stubEnv('PUBLIC_WEB_ORIGIN', 'https://lexiplay.example.test'); vi.stubEnv('MAIL_FROM', 'LexiPlay <mail@example.test>'); vi.stubEnv('RESEND_API_KEY', 'test-only-key');
    const send = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({ id: 'test-message' })); vi.stubGlobal('fetch', send);
    await expect(new AccountMailService().send('learner@example.test', 'reset', 'a'.repeat(43))).resolves.toBeUndefined();
    const body = JSON.parse(send.mock.calls[0]![1]!.body as string);
    expect(body.to).toEqual(['learner@example.test']);
    expect(body.text).toContain('https://lexiplay.example.test/account#action=reset&token=');
    expect(body.text).toContain('30 minutes');
    expect(body.html).toContain('Reset your password');
    expect(body.html).toContain('href="https://lexiplay.example.test/account#action=reset&amp;token=');
    expect(body.text).toContain('Your existing password remains unchanged');
  });
  it('provides a formal verification message with optionality, expiry, and a plain-text alternative', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('MAIL_MODE', 'resend');
    vi.stubEnv('PUBLIC_WEB_ORIGIN', 'https://lexiplay.example.test'); vi.stubEnv('MAIL_FROM', 'LexiPlay <mail@example.test>'); vi.stubEnv('RESEND_API_KEY', 'test-only-key');
    const send = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({ id: 'test-message' })); vi.stubGlobal('fetch', send);
    await new AccountMailService().send('learner@example.test', 'verify', 'a'.repeat(43));
    const body = JSON.parse(send.mock.calls[0]![1]!.body as string);
    expect(body.subject).toBe('LexiPlay — Email address verification');
    for (const content of [body.text, body.html]) {
      expect(content).toContain('24 hours'); expect(content).toContain('can be used only once');
      expect(content).toContain('Email verification is optional'); expect(content).toContain('Do not share this link');
      expect(content).toContain('The LexiPlay team');
    }
    expect(body.html).toContain('Verify your email address</a>');
    expect(body.text).toContain('/account#action=verify&token=');
  });
  it('refuses local previews in production and refuses unencrypted public email links', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('MAIL_MODE', 'local');
    vi.stubEnv('PUBLIC_WEB_ORIGIN', 'https://lexiplay.example.test');
    await expect(new AccountMailService().send('learner@example.test', 'verify', 'a'.repeat(43))).rejects.toThrow('not configured');
    vi.stubEnv('PUBLIC_WEB_ORIGIN', 'http://lexiplay.example.test');
    await expect(new AccountMailService().send('learner@example.test', 'verify', 'a'.repeat(43))).rejects.toThrow('valid web origin');
  });
});
