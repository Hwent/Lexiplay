import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createServer } from 'node:net';
import { developmentEnvironment } from './dev-environment.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const localEnvPath = resolve(scriptDirectory, '../.env');
if (existsSync(localEnvPath)) process.loadEnvFile(localEnvPath);
const apiDirectory = resolve(scriptDirectory, '../apps/api');
const webDirectory = resolve(scriptDirectory, '../apps/web');
const apiRequire = createRequire(resolve(apiDirectory, 'package.json'));
const webRequire = createRequire(resolve(webDirectory, 'package.json'));
const tsx = apiRequire.resolve('tsx/cli');
const viteManifest = JSON.parse(readFileSync(webRequire.resolve('vite/package.json'), 'utf8'));
const vite = resolve(dirname(webRequire.resolve('vite/package.json')), viteManifest.bin.vite);
const children = new Set();

function start(entry, args, cwd, env = {}) {
  const child = spawn(process.execPath, [entry, ...args], {
    cwd,
    env: { ...developmentEnvironment(process.env), ...env },
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  children.add(child);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => process.stderr.write(chunk));
  return child;
}

function stopAll() {
  for (const child of children) {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  }
}

process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

const webPort = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(error => error ? reject(error) : resolve(port));
  });
});
const api = start(tsx, ['watch', 'src/main.ts'], apiDirectory, { PORT: '0', PUBLIC_WEB_ORIGIN: process.env.PUBLIC_WEB_ORIGIN || `http://127.0.0.1:${webPort}` });
const apiOrigin = await new Promise((resolve, reject) => {
  let output = '';
  const timeout = setTimeout(() => reject(new Error('API did not start within 30 seconds.')), 30_000);
  api.stdout.on('data', chunk => {
    process.stdout.write(`[api] ${chunk}`);
    output += chunk;
    const match = output.match(/API_LISTENING=(https?:\/\/\S+)/);
    if (match) {
      clearTimeout(timeout);
      resolve(match[1]);
    }
  });
  api.once('error', error => { clearTimeout(timeout); reject(error); });
  api.once('exit', code => {
    if (code !== 0) { clearTimeout(timeout); reject(new Error(`API exited with code ${code}.`)); }
  });
});

const web = start(vite, ['--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], webDirectory, { API_ORIGIN: apiOrigin });
let webOutput = '';
let urlShown = false;
web.stdout.on('data', chunk => {
  process.stdout.write(`[web] ${chunk}`);
  webOutput += chunk;
  const match = webOutput.match(/http:\/\/127\.0\.0\.1:\d+\//);
  if (match && !urlShown) {
    urlShown = true;
    console.log(`LexiPlay is ready at ${match[0]}`);
  }
});

for (const child of children) {
  child.once('exit', code => {
    if (code !== 0) stopAll();
  });
}
