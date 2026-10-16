import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  if (!process.env.SEED_DATABASE_URL) process.loadEnvFile(resolve(project, '.env.deploy'));
  const source = new URL(process.env.SEED_DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(source.protocol)) throw new Error('SEED_DATABASE_URL must be a PostgreSQL URL.');

  const folder = resolve(project, '.local-backups');
  const filename = `render-${new Date().toISOString().replace(/[-:TZ.]/g, '')}.dump`;
  await mkdir(folder, { recursive: true });

  const connection = {
    PGHOST: source.hostname,
    PGPORT: source.port || '5432',
    PGUSER: decodeURIComponent(source.username),
    PGPASSWORD: decodeURIComponent(source.password),
    PGDATABASE: decodeURIComponent(source.pathname.slice(1)),
    PGSSLMODE: 'verify-full',
    PGSSLROOTCERT: '/etc/ssl/certs/ca-certificates.crt',
    PGCONNECT_TIMEOUT: '20',
  };
  console.log(`Running pg_dump for ${connection.PGDATABASE}…`);
  const child = spawn('docker', [
    'run', '--rm',
    ...Object.keys(connection).flatMap(key => ['--env', key]),
    '--mount', `type=bind,source=${folder},target=/backup`,
    'postgres:17-alpine', 'pg_dump', '--format=custom', `--file=/backup/${filename}`,
  ], { cwd: project, env: { ...process.env, ...connection }, stdio: 'inherit', windowsHide: true });

  child.once('error', error => { console.error(error.message); process.exitCode = 1; });
  child.once('exit', code => {
    process.exitCode = code ?? 1;
    if (code === 0) console.log(`Backup saved to ${resolve(folder, filename)}`);
  });
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
