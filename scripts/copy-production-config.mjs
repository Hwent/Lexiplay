import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

export class CopyConfigurationError extends Error {}

export async function productionCopySource(project, env = process.env) {
  let connection = env.SEED_DATABASE_URL;
  if (!connection) {
    let contents;
    try { contents = await readFile(resolve(project, '.env.deploy'), 'utf8'); }
    catch { throw new CopyConfigurationError('Set SEED_DATABASE_URL in the project .env.deploy file or the shell environment.'); }
    try { connection = parseEnv(contents).SEED_DATABASE_URL; }
    catch { throw new CopyConfigurationError('Could not parse .env.deploy. Check its environment-file syntax.'); }
  }
  if (!connection) throw new CopyConfigurationError('Set SEED_DATABASE_URL in the project .env.deploy file or the shell environment.');
  let source;
  try { source = new URL(connection); }
  catch { throw new CopyConfigurationError('SEED_DATABASE_URL must be a valid external PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(source.protocol) || ['localhost', '127.0.0.1', '[::1]'].includes(source.hostname)) {
    throw new CopyConfigurationError('SEED_DATABASE_URL must use the production external PostgreSQL URL.');
  }
  source.searchParams.set('sslmode', 'verify-full');
  return source;
}
