import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiRequire = createRequire(resolve(project, 'apps/api/package.json'));
const { Pool } = apiRequire('pg');
async function main() {
  let database;
  try { database = new URL(process.env.SEED_DATABASE_URL ?? ''); }
  catch { throw new Error('Set SEED_DATABASE_URL to the Render External Database URL in the private .env.deploy file.'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error('SEED_DATABASE_URL must be a PostgreSQL URL.');
  database.searchParams.set('sslmode', 'verify-full');
  const entry = resolve(project, 'apps/api/dist/modules/word-lists/seed-simple-wiktionary.js');
  if (!existsSync(entry)) throw new Error('Run pnpm build before importing the deployed dictionary.');
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await terminal.question(`Import the first dictionary into ${database.hostname}? This writes to the deployed database. Type SEED to continue: `);
  terminal.close();
  if (answer !== 'SEED') { console.log('Import cancelled.'); return; }
  const pool = new Pool({ connectionString: database.href });
  try {
    const table = await pool.query("SELECT to_regclass('dictionary_words') AS name");
    if (table.rows[0]?.name) {
      const count = await pool.query('SELECT count(*)::int AS count FROM dictionary_words');
      if (count.rows[0].count > 0) { console.log(`The dictionary already has ${count.rows[0].count} entries. First-import setup skipped; no rows were changed.`); return; }
    }
  } finally { await pool.end(); }
  console.log('Importing Simple English Wiktionary. Keep this terminal open until it completes.');
  const child = spawn(process.execPath, [entry], { cwd: project, env: { ...process.env, DATABASE_URL: database.href }, stdio: 'inherit' });
  await new Promise((resolveChild, rejectChild) => { child.once('error', rejectChild); child.once('exit', code => code === 0 ? resolveChild() : rejectChild(new Error('Dictionary import failed. Check the importer output; existing dictionary rows are preserved on failure.'))); });
}
void main().catch(() => { console.error('Dictionary setup did not complete. Check the external URL, Render network access, TLS, and importer output. No credentials are printed by this wrapper.'); process.exitCode = 1; });
