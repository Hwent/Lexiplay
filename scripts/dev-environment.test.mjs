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
    NODE_ENV: 'development', HOST: '127.0.0.1', SERVE_WEB: 'false',
  });
});
