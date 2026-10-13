import { test } from 'node:test';
import assert from 'node:assert/strict';
import { developmentEnvironment } from './dev-environment.mjs';

test('local launch overrides inherited production mode and server settings', () => {
  const env = developmentEnvironment({
    NODE_ENV: 'production', HOST: '0.0.0.0', SERVE_WEB: 'true',
    DATABASE_URL: 'postgresql://local:local@localhost/local', MAIL_MODE: 'local',
  });
  assert.equal(env.NODE_ENV, 'development');
  assert.equal(env.HOST, '127.0.0.1');
  assert.equal(env.SERVE_WEB, 'false');
  assert.equal(env.DATABASE_URL, 'postgresql://local:local@localhost/local');
  assert.equal(env.MAIL_MODE, 'local');
});

test('local launch supplies development defaults when the environment is empty', () => {
  assert.deepEqual(developmentEnvironment({}), {
    NODE_ENV: 'development', HOST: '127.0.0.1', SERVE_WEB: 'false', MAIL_MODE: 'local',
  });
});

test('local launch blocks remote databases without exposing their credentials', () => {
  assert.throws(() => developmentEnvironment({ DATABASE_URL: 'postgresql://private:secret@production.example/app' }), {
    message: 'pnpm dev requires a local PostgreSQL DATABASE_URL. Keep production credentials in .env.deploy, not .env or shell DATABASE_URL.',
  });
  assert.throws(() => developmentEnvironment({ DATABASE_URL: 'not-a-url' }), /valid local DATABASE_URL/);
  assert.throws(() => developmentEnvironment({ DATABASE_URL: 'https://localhost/app' }), /local PostgreSQL/);
});

test('local launch previews email even when a production sender is inherited', () => {
  assert.equal(developmentEnvironment({ MAIL_MODE: 'resend' }).MAIL_MODE, 'local');
});
