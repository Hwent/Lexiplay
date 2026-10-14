import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(existsSync(resolve(project,'.env')))process.loadEnvFile(resolve(project,'.env'));
const database=new URL(process.env.DATABASE_URL??'postgresql://lexiplay:lexiplay@127.0.0.1:5432/lexiplay');
if(!['postgres:','postgresql:'].includes(database.protocol)||!['127.0.0.1','localhost','[::1]'].includes(database.hostname))throw new Error('Local collection migrations require a local DATABASE_URL.');
const require=createRequire(resolve(project,'apps/api/package.json'));
const entry=resolve(dirname(require.resolve('prisma/package.json')),'build/index.js');
const run=args=>new Promise((resolveRun,reject)=>{const child=spawn(process.execPath,[entry,...args],{cwd:resolve(project,'apps/api'),env:{...process.env,DATABASE_URL:database.href},stdio:'inherit',windowsHide:true});child.once('error',reject);child.once('exit',code=>code===0?resolveRun():reject(new Error('Migration command failed.')));});
try {
  const {Pool}=require('pg');const pool=new Pool({connectionString:database.href});
  let baseline=false;
  try{const existing=(await pool.query("SELECT EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations') AS populated,to_regclass('public._prisma_migrations') AS migrations")).rows[0];const applied=existing.migrations?Number((await pool.query('SELECT count(*) FROM _prisma_migrations')).rows[0].count):0;baseline=existing.populated&&applied===0;}finally{await pool.end();}
  if(baseline)await run(['migrate','resolve','--applied','202610140000_legacy_baseline']);
  await run(['migrate','deploy']);
}catch{console.error('Local collection migration failed; database credentials omitted.');process.exitCode=1;}
