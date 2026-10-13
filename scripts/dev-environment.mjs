export function developmentEnvironment(env) {
  if (env.DATABASE_URL) {
    let database;
    try { database = new URL(env.DATABASE_URL); } catch { throw new Error('Development needs a valid local DATABASE_URL.'); }
    if (!['postgres:', 'postgresql:'].includes(database.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)) {
      throw new Error('pnpm dev requires a local PostgreSQL DATABASE_URL. Keep production credentials in .env.deploy, not .env or shell DATABASE_URL.');
    }
  }
  return { ...env, NODE_ENV: 'development', HOST: '127.0.0.1', SERVE_WEB: 'false', MAIL_MODE: 'local' };
}
