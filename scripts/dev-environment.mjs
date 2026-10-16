export function developmentEnvironment(env) {
  if (env.DATABASE_URL) {
    let database;
    try { database = new URL(env.DATABASE_URL); } catch { throw new Error('Development needs a valid local DATABASE_URL.'); }
    if (!['postgres:', 'postgresql:'].includes(database.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)) {
      throw new Error('pnpm dev requires a local PostgreSQL DATABASE_URL. Use SEED_DATABASE_URL for production credentials.');
    }
  }
  return { ...env, NODE_ENV: 'development', HOST: '127.0.0.1', SERVE_WEB: 'false', MAIL_MODE: 'local' };
}
