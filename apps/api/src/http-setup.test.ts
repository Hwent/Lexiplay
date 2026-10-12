import 'reflect-metadata';
import { Controller, Get, Module, Req } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtemp, mkdir, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configureHttp, serverConfig } from './http-setup';

@Controller('health') class TestHealthController {
  @Get() health() { return { status: 'ok' }; }
  @Get('ip') ip(@Req() request: { ip: string }) { return { ip: request.ip }; }
}
@Module({ controllers: [TestHealthController] }) class TestAppModule {}
const production = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://test:test@localhost/test', MAIL_MODE: 'resend', MAIL_FROM: 'LexiPlay <test@example.test>', RESEND_API_KEY: 'test-only-key', RENDER_EXTERNAL_URL: 'https://lexiplay.example.test' };
describe('production HTTP setup', () => {
  let app: NestExpressApplication | undefined; let directory: string | undefined;
  afterEach(async () => {
    await app?.close(); app = undefined;
    if (directory) { await unlink(join(directory, 'index.html')); await unlink(join(directory, 'assets/app.js')); await rmdir(join(directory, 'assets')); await rmdir(directory); directory = undefined; }
  });
  it('serves browser deep links and assets on the API origin without masking API/asset errors', async () => {
    directory = await mkdtemp(join(tmpdir(), 'lexiplay-web-')); await mkdir(join(directory, 'assets'));
    await writeFile(join(directory, 'index.html'), '<!doctype html><title>LexiPlay production</title><div id="root"></div>');
    await writeFile(join(directory, 'assets/app.js'), 'console.log("production fixture");');
    app = await NestFactory.create<NestExpressApplication>(TestAppModule, { logger: false });
    configureHttp(app, serverConfig({ ...production, PORT: '0', TRUST_PROXY_HOPS: '1' }), directory);
    await app.listen(0, '127.0.0.1'); const origin = await app.getUrl();
    for (const route of ['/', '/account', '/games', '/library', '/progress']) {
      const result = await fetch(origin + route); expect(result.status).toBe(200); expect(result.headers.get('cache-control')).toBe('no-store'); expect(await result.text()).toContain('LexiPlay production');
    }
    const asset = await fetch(origin + '/assets/app.js'); expect(asset.status).toBe(200); expect(await asset.text()).toContain('production fixture');
    const health = await fetch(origin + '/api/v1/health'); expect(await health.json()).toEqual({ status: 'ok' }); expect(health.headers.get('x-content-type-options')).toBe('nosniff');
    for (const route of ['/api/v1/missing', '/assets/missing.js', '/.env']) expect((await fetch(origin + route)).status).toBe(404);
    const ip = await fetch(origin + '/api/v1/health/ip', { headers: { 'x-forwarded-for': '198.51.100.7, 203.0.113.9' } }); expect(await ip.json()).toEqual({ ip: '203.0.113.9' });
  });
  it('keeps development on loopback and validates production settings without exposing values', () => {
    expect(serverConfig({})).toMatchObject({ host: '127.0.0.1', serveWeb: false, proxyHops: 0 });
    expect(serverConfig(production)).toMatchObject({ host: '0.0.0.0', serveWeb: true, publicOrigin: production.RENDER_EXTERNAL_URL });
    expect(serverConfig({ ...production, PUBLIC_WEB_ORIGIN: 'https://custom.example.test' }).publicOrigin).toBe('https://custom.example.test');
    expect(() => serverConfig({ ...production, DATABASE_URL: 'invalid-secret-value' })).toThrow('Production needs a valid DATABASE_URL.');
    expect(() => serverConfig({ ...production, PUBLIC_WEB_ORIGIN: 'http://example.test' })).toThrow('HTTPS origin');
    expect(() => serverConfig({ ...production, MAIL_MODE: 'local' })).toThrow('MAIL_MODE=resend');
    expect(() => serverConfig({ PORT: 'NaN' })).toThrow('PORT'); expect(() => serverConfig({ TRUST_PROXY_HOPS: 'true' })).toThrow('TRUST_PROXY_HOPS');
  });
});
