import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { productionCopySource } from './copy-production-config.mjs';

test('plain node invocation loads the project .env.deploy without shell variables', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'lexiplay-copy-test-'));
  try {
    await writeFile(join(folder, '.env.deploy'), 'SEED_DATABASE_URL="postgresql://fixture:fixture@db.example.test/production"\n');
    const source = await productionCopySource(folder, {});
    assert.equal(source.hostname, 'db.example.test');
    assert.equal(source.searchParams.get('sslmode'), 'verify-full');
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('explicit shell setting takes precedence over the deployment file', async () => {
  const source = await productionCopySource('unused', { SEED_DATABASE_URL: 'postgresql://fixture:fixture@override.example.test/production' });
  assert.equal(source.hostname, 'override.example.test');
});

test('invalid settings produce actionable errors without including credentials', async () => {
  await assert.rejects(productionCopySource('unused', { SEED_DATABASE_URL: 'secret-fixture-value' }), error => {
    assert.match(error.message, /SEED_DATABASE_URL/);
    assert.ok(!error.message.includes('secret-fixture-value'));
    return true;
  });
});
