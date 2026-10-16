import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { PrismaClient, Prisma } from '../apps/api/src/generated/prisma/client';
import { assertCompatible, distinctDatabases, fingerprint, equalFingerprint, mergePublic, upsert, PUBLIC_TABLES, quote, tables } from './database-redeploy-core.mjs';
import { sqlStatements } from './sql-statements.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(project,'apps/api/package.json'));
const { Client, types } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
types.setTypeParser(1114,(value: string) => value);
types.setTypeParser(1184,(value: string) => value);
let stage = 'configuration';
const pgClients: any[] = [], prismaClients: PrismaClient[] = [];
const local = (url: URL) => ['127.0.0.1','localhost','[::1]'].includes(url.hostname);
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
function run(args: string[], env = process.env) {
  return new Promise<string>((accept,reject) => {
    const child=spawn('docker',args,{cwd:project,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output=''; child.stdout.on('data',chunk=>{output+=chunk;}); child.stderr.on('data',()=>{});
    child.once('error',()=>reject(new Error('Docker unavailable.')));
    child.once('exit',code=>code===0?accept(output.trim()):reject(new Error('PostgreSQL backup/restore command failed.')));
  });
}
async function pgTool(url: URL,folder: string,command: string,args: string[]) {
  const env={...process.env,PGHOST:local(url)?'host.docker.internal':url.hostname,PGPORT:url.port||'5432',
    PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:decodeURIComponent(url.pathname.slice(1)),
    PGSSLMODE:local(url)?'disable':'verify-full',PGSSLROOTCERT:'/etc/ssl/certs/ca-certificates.crt',PGCONNECT_TIMEOUT:'20',
    PGOPTIONS:`-c timezone=UTC${command==='pg_dump'?' -c default_transaction_read_only=on':''}`};
  return run(['run','--rm',...['PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE','PGSSLROOTCERT','PGCONNECT_TIMEOUT','PGOPTIONS'].flatMap(key=>['--env',key]),
    '--mount',`type=bind,source=${folder},target=/backup`,'postgres:17-alpine',command,...args],env);
}
async function pg(url: URL) {
  const client=new Client({connectionString:url.href,connectionTimeoutMillis:20000});pgClients.push(client);await client.connect();
  await client.query("SET TIME ZONE 'UTC'");
  const version=Number((await client.query('SHOW server_version_num')).rows[0].server_version_num);
  if(version<170000||version>=180000)throw new Error('Requires PostgreSQL 17.');
  return client;
}
function prisma(url: URL) { const client=new PrismaClient({adapter:new PrismaPg({connectionString:url.href,max:2})}); prismaClients.push(client);return client; }
function bridge(tx: Prisma.TransactionClient) {
  return {async query(sql: string,parameters: any[] = []) {
    if (/^\s*(SELECT|SHOW|WITH)\b/i.test(sql)) return {rows:await tx.$queryRawUnsafe(sql,...parameters)};
    return {rows:[],rowCount:await tx.$executeRawUnsafe(sql,...parameters)};
  }};
}
async function originalPrivate(client: any, columns: any[]) {
  const result: Record<string, any>={};
  const names=[...new Set<string>(columns.map(row=>row.table_name))].filter(name=>!Object.hasOwn(PUBLIC_TABLES,name));
  for(const name of names) {
    const selected=columns.filter(row=>row.table_name===name).map(row=>quote(row.column_name)).join(',');
    result[name]=(await client.query(`SELECT count(*)::text AS count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) AS hash FROM (SELECT md5(row_to_json(t)::text) h FROM (SELECT ${selected} FROM public.${quote(name)}) t) rows`)).rows[0];
  }
  return result;
}
async function upgrade(tx: Prisma.TransactionClient, source: any) {
  const db=bridge(tx), names=await tables(db);
  const savedLists=names.includes('user_word_lists')?(await db.query('SELECT id,name FROM user_word_lists')).rows as any[]:[];
  const duplicates=(await db.query('SELECT owner_id FROM user_word_lists GROUP BY owner_id HAVING count(*)>1')).rows as any[];
  if(duplicates.length)throw new Error('Multiple legacy lists per user require a separately reviewed consolidation.');
  await db.query(`CREATE TABLE IF NOT EXISTS _prisma_migrations(id varchar(36) PRIMARY KEY,checksum varchar(64) NOT NULL,finished_at timestamptz,migration_name varchar(255) NOT NULL,logs text,rolled_back_at timestamptz,started_at timestamptz NOT NULL DEFAULT now(),applied_steps_count integer NOT NULL DEFAULT 0)`);
  const applied=(await db.query('SELECT migration_name,finished_at,rolled_back_at FROM _prisma_migrations')).rows as any[];
  if(applied.some(row=>!row.finished_at&&!row.rolled_back_at))throw new Error('Target has an unfinished migration.');
  for(const name of ['202610140000_legacy_baseline','202610140001_vocabulary_collections','202610140002_single_personal_list']) {
    if(applied.some(row=>row.migration_name===name&&row.finished_at&&!row.rolled_back_at))continue;
    const sql=await readFile(resolve(project,'apps/api/prisma/migrations',name,'migration.sql'),'utf8');
    if(name!=='202610140000_legacy_baseline')for(const statement of sqlStatements(sql)) {
      const code=statement.replace(/--[^\n]*(?:\n|$)/g,'').trim();
      if(!/^(BEGIN|COMMIT)$/i.test(code))await tx.$executeRawUnsafe(statement);
    }
    await tx.$executeRawUnsafe('INSERT INTO _prisma_migrations(id,checksum,migration_name,started_at,finished_at,applied_steps_count) VALUES($1,$2,$3,now(),now(),1)',randomUUID(),hash(sql),name);
  }
  // The legacy migration standardizes list names; restore the original user-owned names.
  for(const row of savedLists)await tx.$executeRawUnsafe('UPDATE user_word_lists SET name=$1 WHERE id=$2::uuid',row.name,row.id);
  for(const sql of [
    'ALTER TABLE dictionary_words ALTER COLUMN term TYPE text',
    "ALTER TABLE dictionary_words ADD COLUMN IF NOT EXISTS senses jsonb NOT NULL DEFAULT '[]'::jsonb",
    'ALTER TABLE user_words ALTER COLUMN part_of_speech TYPE text',
    `CREATE TABLE IF NOT EXISTS dictionary_sources(id text PRIMARY KEY,name text NOT NULL,version text NOT NULL,url text NOT NULL,license text NOT NULL,content_sha256 text NOT NULL,archive_sha256 text,imported_at timestamptz NOT NULL DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS dictionary_source_words(source_id text NOT NULL REFERENCES dictionary_sources(id),term text NOT NULL,data jsonb NOT NULL,PRIMARY KEY(source_id,term))`,
    `CREATE TABLE IF NOT EXISTS game_word_pools(id text PRIMARY KEY,name text NOT NULL,cefr_level text NOT NULL,author text NOT NULL,words jsonb NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS user_game_pools(owner_id uuid NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,pool_id text NOT NULL REFERENCES game_word_pools(id) ON DELETE CASCADE,added_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(owner_id,pool_id))`,
  ])await tx.$executeRawUnsafe(sql);
  await assertCompatible(source,db,{previewHistoryMismatch:true});
}
async function importLegacy(tx: Prisma.TransactionClient) {
  const words=await tx.$queryRawUnsafe<any[]>('SELECT * FROM user_words ORDER BY created_at,id');
  let imported=0;
  for(const word of words) {
    const canonical=await tx.$queryRawUnsafe<any[]>('SELECT term,part_of_speech FROM dictionary_words WHERE lower(term)=lower($1) ORDER BY (term=$1) DESC LIMIT 1',word.term);
    if(!canonical.length)throw new Error('A legacy saved word has no dictionary match. Original data preserved; resolve the match before publishing.');
    const record=canonical[0];
    const partOfSpeech=record.part_of_speech.includes(word.part_of_speech)?word.part_of_speech:record.part_of_speech[0]??'noun';
    const entry=await tx.dictionaryEntry.upsert({where:{normalizedLemma_partOfSpeech:{normalizedLemma:record.term.toLowerCase(),partOfSpeech}},create:{lemma:record.term,normalizedLemma:record.term.toLowerCase(),partOfSpeech},update:{}});
    const exists=await tx.wordListEntry.findUnique({where:{wordListId_dictionaryEntryId:{wordListId:word.list_id,dictionaryEntryId:entry.id}}});
    if(exists)continue;
    const personal=await tx.wordListEntry.create({data:{id:word.id,wordListId:word.list_id,dictionaryEntryId:entry.id,stage:word.learning_stage??'Core',createdAt:new Date(word.created_at)}});
    await tx.learningProgress.create({data:{wordListEntryId:personal.id,familiarity:word.status==='KNOWN'?5:word.familiarity??0,nextReviewAt:word.next_review_at?new Date(word.next_review_at):null}});
    imported++;
  }
  return imported;
}
async function alignDictionary(tx: Prisma.TransactionClient,source: any,folder: string) {
  const allowed=(await source.query('SELECT term FROM dictionary_words')).rows.map((row: any)=>row.term);
  await tx.$executeRawUnsafe('CREATE TEMP TABLE redeploy_allowed_terms(term text PRIMARY KEY) ON COMMIT DROP');
  await tx.$executeRawUnsafe('INSERT INTO redeploy_allowed_terms SELECT jsonb_array_elements_text($1::jsonb)',JSON.stringify(allowed));
  await tx.$executeRawUnsafe('ANALYZE redeploy_allowed_terms');
  const missing=await tx.$queryRawUnsafe<any[]>('SELECT count(*)::text n FROM user_words w WHERE NOT EXISTS(SELECT 1 FROM redeploy_allowed_terms a WHERE lower(a.term)=lower(w.term))');
  if(Number(missing[0].n))throw new Error('Saved legacy words are missing from development dictionary. Resolve their dictionary mapping first.');
  const removed=await tx.$queryRawUnsafe<any[]>('SELECT * FROM dictionary_words d WHERE NOT EXISTS(SELECT 1 FROM redeploy_allowed_terms a WHERE a.term=d.term) ORDER BY term');
  await writeFile(resolve(folder,'removed-public-words.json.gz'),gzipSync(JSON.stringify(removed)),{mode:0o600});
  // Replace the complete public table, including every definition and POS/sense payload.
  // User words reference personal lists / dictionary_entries, never this raw dictionary table.
  await tx.$executeRawUnsafe('DELETE FROM dictionary_words');
  const sourceRows=(await source.query('SELECT * FROM dictionary_words')).rows;
  console.log(`Replacing public dictionary from development: ${sourceRows.length} rows`);
  await upsert(bridge(tx),'dictionary_words',sourceRows,['term']);
  const deleted=removed.length;
  const query="SELECT count(*)::text AS count,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) AS hash FROM (SELECT md5(row_to_json(t)::text) h FROM (SELECT term,definition,part_of_speech,senses FROM dictionary_words) t) rows";
  const expected=(await source.query(query)).rows[0];
  const actual=(await tx.$queryRawUnsafe<any[]>(query))[0];
  await writeFile(resolve(folder,'strict-dictionary-comparison.json'),JSON.stringify({expected,actual},null,2),{mode:0o600});
  if(expected.count!==actual.count||expected.hash!==actual.hash)throw new Error('Target dictionary content differs from development. Strict alignment rolled back.');
  return {removedOldOnlyWords:deleted,dictionaryCount:actual.count,dictionaryHash:actual.hash,exactDevelopmentDictionary:true};
}
async function merge(client: PrismaClient,source: any,baseline: any,columns: any[],before: any,{locks=false,strict=false,folder}: {locks?:boolean;strict?:boolean;folder?:string}={}) {
  return client.$transaction(async tx=>{
    await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'UTC'");
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout='15s'");
    const db=bridge(tx);
    if(locks) {
      const names=await tables(db);
      await tx.$executeRawUnsafe(`LOCK TABLE ${names.map(name=>`public.${quote(name)}`).join(',')} IN SHARE ROW EXCLUSIVE MODE`);
      if(!equalFingerprint(baseline,await fingerprint(db)))throw new Error('Target changed after backup. Rerun preparation; nothing was committed.');
    }
    await upgrade(tx,source);
    const mergedRows=await mergePublic(source,db,{transactionManaged:true,previewHistoryMismatch:true});
    const dictionaryAlignment=strict?await alignDictionary(tx,source,folder!):null;
    const importedLegacyWords=await importLegacy(tx);
    if(!equalFingerprint(before,await originalPrivate(db,columns)))throw new Error('Original user data changed; transaction rolled back.');
    const counts=await fingerprint(db);
    return {mergedRows,importedLegacyWords,counts,dictionaryAlignment,originalUserDataUnchanged:true};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:900000,maxWait:30000});
}
async function main() {
  const {values}=parseArgs({options:{'source-database':{type:'string'},'target-database':{type:'string'},'align-only':{type:'boolean'},'backup-dir':{type:'string'},'strict-dictionary':{type:'boolean'},apply:{type:'boolean'},help:{type:'boolean'}}});
  if(values.help){console.log('pnpm db:redeploy:prisma --source-database <local-name> --target-database <name> [--strict-dictionary] [--apply]');return;}
  if(!values['source-database']||!values['target-database'])throw new Error('Pass --source-database <name> --target-database <name> [--apply].');
  const env=parseEnv(await readFile(resolve(project,'.env'),'utf8'));
  const sourceUrl=new URL(process.env.PRISMA_REDEPLOY_SOURCE_URL||env.DATABASE_URL);
  const targetUrl=new URL(process.env.PRISMA_REDEPLOY_TARGET_URL||env.SEED_DATABASE_URL);
  if(!local(sourceUrl))throw new Error('Source must be the local development database.');
  if(decodeURIComponent(sourceUrl.pathname.slice(1))!==values['source-database']||decodeURIComponent(targetUrl.pathname.slice(1))!==values['target-database'])throw new Error('Configured database names do not match the explicitly requested names.');
  if(!local(targetUrl))targetUrl.searchParams.set('sslmode','verify-full');
  distinctDatabases(sourceUrl.href,targetUrl.href);
  if(values['align-only']) {
    if(!values.apply||!values['backup-dir'])throw new Error('Strict alignment requires --apply --backup-dir <existing verified backup folder>.');
    const folder=resolve(project,values['backup-dir']);
    if(!folder.startsWith(resolve(project,'.local-backups')+sep))throw new Error('Use a backup folder under .local-backups.');
    const backup=JSON.parse(await readFile(resolve(folder,'before.json'),'utf8'));
    if(backup.sourceDatabase!==values['source-database']||backup.targetDatabase!==values['target-database']||hash(await readFile(resolve(folder,'target-before.dump')))!==backup.backupSha256)throw new Error('Backup identity/checksum mismatch.');
    const source=await pg(sourceUrl),target=await pg(targetUrl);
    await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    stage='strict Prisma dictionary alignment';console.log(stage);
    const report=await prisma(targetUrl).$transaction(async tx=>{
      await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'UTC'");
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout='15s'");
      const db=bridge(tx),names=await tables(db);
      await tx.$executeRawUnsafe(`LOCK TABLE ${names.map(name=>`public.${quote(name)}`).join(',')} IN SHARE ROW EXCLUSIVE MODE`);
      const privateNames=names.filter(name=>!Object.hasOwn(PUBLIC_TABLES,name));
      const before=await fingerprint(db,privateNames);
      if(!equalFingerprint(backup.originalUserData,await originalPrivate(db,backup.columns)))throw new Error('Original user data differs from the initial backup; review before alignment.');
      const aligned=await alignDictionary(tx,source,folder);
      if(!equalFingerprint(before,await fingerprint(db,privateNames)))throw new Error('User data changed during alignment; rolled back.');
      return {...aligned,originalUserDataUnchanged:true,allUserDataUnchanged:true,privateData:before};
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:900000,maxWait:30000});
    if(!equalFingerprint(report.privateData,await fingerprint(target,Object.keys(report.privateData))))throw new Error('Alignment committed but private verification differs. Keep application paused.');
    await writeFile(resolve(folder,'strict-alignment.json'),JSON.stringify({appliedAt:new Date().toISOString(),...report},null,2),{mode:0o600});
    await source.query('COMMIT');
    console.log(`Strict alignment committed and verified: removed=${report.removedOldOnlyWords}, dictionary=${report.dictionaryCount}, original and new user data unchanged.`);
    return;
  }
  const id=`lexiplay_prisma_${new Date().toISOString().replace(/[-:TZ.]/g,'')}`;
  const folder=resolve(project,'.local-backups',id);await mkdir(folder,{recursive:true,mode:0o700});
  console.log(`Backup folder: ${folder}`);
  stage='development connection';
  const source=await pg(sourceUrl);
  stage='target connection';
  const target=await pg(targetUrl);
  stage='consistent source and target snapshots';
  await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await target.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const snapshot=(await target.query('SELECT pg_export_snapshot() id')).rows[0].id;
  const baseline=await fingerprint(target);
  const columns=(await target.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,column_name")).rows;
  const before=await originalPrivate(target,columns);
  stage='full target backup';console.log(stage);
  await pgTool(targetUrl,folder,'pg_dump',['--format=custom','--no-owner','--no-acl',`--snapshot=${snapshot}`,'--file=/backup/target-before.dump']);
  const privateNames=Object.keys(before);
  await pgTool(targetUrl,folder,'pg_dump',['--format=custom','--data-only','--no-owner','--no-acl',`--snapshot=${snapshot}`,...privateNames.map(name=>`--table=public.${quote(name)}`),'--file=/backup/users-before.dump']);
  await target.query('COMMIT');
  await writeFile(resolve(folder,'before.json'),JSON.stringify({sourceDatabase:values['source-database'],targetDatabase:values['target-database'],baseline,originalUserData:before,columns,backupSha256:hash(await readFile(resolve(folder,'target-before.dump')))},null,2),{mode:0o600});
  stage='isolated target-clone restore';console.log(stage);
  await run(['compose','exec','-T','database','createdb','-U','lexiplay',id]);
  const candidateUrl=new URL(`postgresql://lexiplay:lexiplay@127.0.0.1:5432/${id}`);
  const contents=await pgTool(candidateUrl,folder,'pg_restore',['--list','/backup/target-before.dump']);
  await writeFile(resolve(folder,'restore.list'),contents.split('\n').filter(line=>!/^\d+; \d+ \d+ (?:SCHEMA - public|COMMENT - SCHEMA public)(?:\s|$)/.test(line)).join('\n'));
  await pgTool(candidateUrl,folder,'pg_restore',['--dbname',id,'--no-owner','--no-acl','--single-transaction','--exit-on-error','--use-list','/backup/restore.list','/backup/target-before.dump']);
  const candidatePg=await pg(candidateUrl);
  if(!equalFingerprint(baseline,await fingerprint(candidatePg)))throw new Error('Restored backup did not match target snapshot.');
  stage='Prisma clone schema upgrade and merge';console.log(stage);
  const preview=await merge(prisma(candidateUrl),source,baseline,columns,before,{strict:Boolean(values['strict-dictionary']),folder});
  await writeFile(resolve(folder,'preview.json'),JSON.stringify(preview,null,2),{mode:0o600});
  console.log(`Verified preview: dictionary=${preview.counts.dictionary_words.count}, accounts=${preview.counts.account_users.count}, legacyWordsImported=${preview.importedLegacyWords}`);
  if(values.apply) {
    stage='atomic Prisma target merge';console.log(stage);
    const applied=await merge(prisma(targetUrl),source,baseline,columns,before,{locks:true,strict:Boolean(values['strict-dictionary']),folder});
    stage='post-commit target verification';
    if(!equalFingerprint(applied.counts,await fingerprint(target))||!equalFingerprint(before,await originalPrivate(target,columns)))throw new Error('Merge committed but post-commit verification changed. Keep writers paused and inspect the backup/report.');
    await writeFile(resolve(folder,'applied.json'),JSON.stringify({appliedAt:new Date().toISOString(),...applied},null,2),{mode:0o600});
    console.log(`Committed and verified: ${values['target-database']}; original user data unchanged; dictionary=${applied.counts.dictionary_words.count}; savedWordsImported=${applied.importedLegacyWords}`);
  } else console.log('Preview verified; target unchanged. Add --apply to prepare a new backup, revalidate, and commit.');
  await source.query('COMMIT');
}
main().catch(error=>{
  const safe=error?.constructor===Error&&!error.code?error.message:'Database operation failed; credentials and row values omitted.';
  console.error(`Stopped during ${stage}: ${safe}`);process.exitCode=1;
}).finally(async()=>{await Promise.allSettled([...pgClients.map(client=>client.end()),...prismaClients.map(client=>client.$disconnect())]);});
