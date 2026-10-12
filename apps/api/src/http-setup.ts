import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function serverConfig(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === 'production';
  const port = Number(env.PORT ?? 3000);
  const proxyHops = Number(env.TRUST_PROXY_HOPS ?? 0);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer between 0 and 65535.');
  if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 10) throw new Error('TRUST_PROXY_HOPS must be an integer between 0 and 10.');
  if (env.SERVE_WEB && !['true', 'false'].includes(env.SERVE_WEB)) throw new Error('SERVE_WEB must be true or false.');
  const publicOrigin = env.PUBLIC_WEB_ORIGIN || env.RENDER_EXTERNAL_URL;
  if (production) {
    try { if (!['postgres:', 'postgresql:'].includes(new URL(env.DATABASE_URL ?? '').protocol)) throw new Error(); }
    catch { throw new Error('Production needs a valid DATABASE_URL.'); }
    let origin: URL;
    try { origin = new URL(publicOrigin ?? ''); } catch { throw new Error('Production needs PUBLIC_WEB_ORIGIN or RENDER_EXTERNAL_URL.'); }
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('The production web origin must be an HTTPS origin without credentials, a path, or query.');
    if (env.MAIL_MODE !== 'resend' || !env.MAIL_FROM || !env.RESEND_API_KEY) throw new Error('Production needs MAIL_MODE=resend, MAIL_FROM, and RESEND_API_KEY.');
  }
  return { port, host: env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1'), proxyHops, serveWeb: env.SERVE_WEB ? env.SERVE_WEB === 'true' : production, publicOrigin };
}

export function configureHttp(app: NestExpressApplication, config: ReturnType<typeof serverConfig>, webRoot = resolve(__dirname, '../../web/dist')) {
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.set('trust proxy', config.proxyHops);
  app.disable('x-powered-by');
  app.use((_request: unknown, response: { setHeader(name: string, value: string): void }, next: () => void) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  if (!config.serveWeb) return;
  const index = resolve(webRoot, 'index.html');
  if (!existsSync(index)) throw new Error('The built website is missing. Run pnpm build before starting production.');
  app.useStaticAssets(webRoot, { index: false, dotfiles: 'deny' });
  // Browser routes receive the SPA; API endpoints and missing asset files retain real 404s.
  app.use((request: { method: string; path: string }, response: { setHeader(name: string, value: string): void; sendFile(path: string): void }, next: () => void) => {
    if (!['GET', 'HEAD'].includes(request.method) || !/^\/(?!api(?:\/|$)|assets(?:\/|$))[^.]*$/.test(request.path)) { next(); return; }
    response.setHeader('Cache-Control', 'no-store');
    response.sendFile(index);
  });
}
