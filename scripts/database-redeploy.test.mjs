import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assertEmpty, databaseIdentity, distinctDatabases, equalFingerprint, fingerprint, mergePublic, quote } from './database-redeploy-core.mjs';

test('database identities reject aliases of the same database', () => {
  assert.equal(databaseIdentity('postgres://u:p@localhost/db'), databaseIdentity('postgresql://other:secret@127.0.0.1:5432/db'));
  assert.throws(() => distinctDatabases('postgres://u:p@localhost/db','postgres://u:p@127.0.0.1/db'), /different databases/);
});
test('fingerprints compare values independently of driver property order', () => {
  assert.equal(equalFingerprint({a:{count:'2',hash:'abc'},b:{count:'0',hash:'def'}},{b:{hash:'def',count:'0'},a:{hash:'abc',count:'2'}}),true);
  assert.equal(equalFingerprint({a:{count:'2',hash:'abc'}},{a:{hash:'changed',count:'2'}}),false);
});

const integrationUrl = process.env.TEST_REDEPLOY_URL;
test('disposable PostgreSQL: preserve users, remap IDs, rollback, backup, restore and reject unsafe publish', { skip: !integrationUrl, timeout: 180000 }, async () => {
  const base = new URL(integrationUrl);
  assert.ok(['localhost','127.0.0.1'].includes(base.hostname), 'Tests only use local PostgreSQL');
  const { Client } = createRequire(resolve('apps/api/package.json'))('pg');
  const admin = new Client({ connectionString: base.href });
  await admin.connect();
  const prefix = `lexiplay_test_redeploy_${Date.now()}`;
  const names = ['dev','prod','fresh','merged'].map(suffix => `${prefix}_${suffix}`);
  const clients = [];
  const urls = [];
  try {
    for (const name of names) {
      await admin.query(`CREATE DATABASE ${quote(name)}`);
      const url = new URL(base); url.pathname = `/${name}`; urls.push(url.href);
      const client = new Client({ connectionString: url.href }); await client.connect(); clients.push(client);
    }
    const [dev, prod, fresh, merged] = clients;
    const schema = `
      CREATE TABLE dictionary_words(term text PRIMARY KEY,definition text,part_of_speech text[],senses jsonb);
      CREATE TABLE dictionary_sources(id text PRIMARY KEY,name text,imported_at timestamptz);
      CREATE TABLE dictionary_source_words(source_id text REFERENCES dictionary_sources(id),term text,data jsonb,PRIMARY KEY(source_id,term));
      CREATE TABLE dictionary_entries(id uuid PRIMARY KEY,lemma text,normalized_lemma text,part_of_speech text,UNIQUE(normalized_lemma,part_of_speech));
      CREATE TABLE dictionary_definitions(id uuid PRIMARY KEY,dictionary_entry_id uuid REFERENCES dictionary_entries(id),language text,sense_index int,definition text,UNIQUE(dictionary_entry_id,language,sense_index));
      CREATE TABLE vocabulary_collections(id uuid PRIMARY KEY,slug text UNIQUE,name text);
      CREATE TABLE collection_entries(collection_id uuid REFERENCES vocabulary_collections(id),dictionary_entry_id uuid REFERENCES dictionary_entries(id),stage text,sort_order int,PRIMARY KEY(collection_id,dictionary_entry_id));
      CREATE TABLE game_word_pools(id text PRIMARY KEY,name text,words jsonb);
      CREATE TABLE account_users(id uuid PRIMARY KEY,username text,password_hash text);
      CREATE TABLE word_list_entries(id uuid PRIMARY KEY,owner_id uuid REFERENCES account_users(id),dictionary_entry_id uuid REFERENCES dictionary_entries(id),imported_collection_id uuid REFERENCES vocabulary_collections(id));
      CREATE TABLE learning_progress(id uuid PRIMARY KEY,entry_id uuid REFERENCES word_list_entries(id),familiarity int);
      CREATE TABLE future_private_table(id text PRIMARY KEY,payload jsonb);
    `;
    for (const client of [dev,prod]) await client.query(schema);
    const devEntry = randomUUID(), prodEntry = randomUUID(), prodOnlyEntry = randomUUID();
    const devCollection = randomUUID(), prodCollection = randomUUID(), user = randomUUID(), personalEntry = randomUUID();
    for (const [client, entry, collection, definition, username] of [[dev,devEntry,devCollection,'new definition','development-only'],[prod,prodEntry,prodCollection,'old definition','production-user']]) {
      await client.query("INSERT INTO dictionary_words VALUES ('common',$1,ARRAY['noun'],'[]')", [definition]);
      await client.query("INSERT INTO dictionary_sources VALUES ('source','source','2026-10-14 12:34:56.123456+00')");
      await client.query("INSERT INTO dictionary_source_words VALUES ('source','common','{}')");
      await client.query("INSERT INTO dictionary_entries VALUES ($1,'common','common','noun')", [entry]);
      await client.query("INSERT INTO dictionary_definitions VALUES ($1,$2,'en',0,$3)", [randomUUID(),entry,definition]);
      await client.query("INSERT INTO vocabulary_collections VALUES ($1,'cefr-c2','C2')", [collection]);
      await client.query("INSERT INTO collection_entries VALUES ($1,$2,'new',0)", [collection,entry]);
      await client.query("INSERT INTO game_word_pools VALUES ('c2','C2','[\"common\"]')");
      await client.query('INSERT INTO account_users VALUES ($1,$2,$3)', [client === prod ? user : randomUUID(),username,'fixture-hash']);
      await client.query("INSERT INTO future_private_table VALUES ('private','{\"preserve\":true}')");
    }
    await prod.query("INSERT INTO dictionary_entries VALUES ($1,'legacy','legacy','noun')", [prodOnlyEntry]);
    await prod.query('INSERT INTO word_list_entries VALUES ($1,$2,$3,$4)', [personalEntry,user,prodEntry,prodCollection]);
    await prod.query('INSERT INTO learning_progress VALUES ($1,$2,4)', [randomUUID(),personalEntry]);
    const newDevEntry = randomUUID();
    await dev.query("INSERT INTO dictionary_entries VALUES ($1,'new word','new word','noun')", [newDevEntry]);
    await dev.query("INSERT INTO dictionary_definitions VALUES ($1,$2,'en',0,'new word definition')", [randomUUID(),newDevEntry]);
    await dev.query("INSERT INTO collection_entries VALUES ($1,$2,'new',1)", [devCollection,newDevEntry]);
    const protectedNames = ['account_users','word_list_entries','learning_progress','future_private_table'];
    const before = await fingerprint(prod,protectedNames);
    await mergePublic(dev,prod);
    assert.deepEqual(await fingerprint(prod,protectedNames),before);
    assert.equal((await prod.query("SELECT id FROM dictionary_entries WHERE normalized_lemma='common'")).rows[0].id,prodEntry);
    assert.equal((await prod.query("SELECT definition FROM dictionary_definitions WHERE dictionary_entry_id=$1",[prodEntry])).rows[0].definition,'new definition');
    assert.equal((await prod.query('SELECT count(*)::int AS n FROM dictionary_entries')).rows[0].n,3);
    const newProdEntry = (await prod.query("SELECT id FROM dictionary_entries WHERE normalized_lemma='new word'")).rows[0].id;
    assert.notEqual(newProdEntry,newDevEntry);
    assert.equal((await prod.query('SELECT collection_id FROM collection_entries WHERE dictionary_entry_id=$1',[newProdEntry])).rows[0].collection_id,prodCollection);
    // Force failure after dictionary_words to prove the entire merge rolls back.
    await dev.query("UPDATE dictionary_words SET definition='should rollback'");
    await prod.query("CREATE FUNCTION reject_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$; CREATE TRIGGER reject_source BEFORE INSERT OR UPDATE ON dictionary_sources FOR EACH ROW EXECUTE FUNCTION reject_source()");
    await assert.rejects(mergePublic(dev,prod));
    assert.equal((await prod.query('SELECT definition FROM dictionary_words')).rows[0].definition,'new definition');
    await prod.query('DROP TRIGGER reject_source ON dictionary_sources; DROP FUNCTION reject_source()');
    await dev.query("UPDATE dictionary_words SET definition='new definition'");
    await assert.rejects(assertEmpty(prod), /not empty/);

    const cli = async (args, target = urls[2]) => new Promise((accept,reject) => {
      const child = spawn(process.execPath,['scripts/database-redeploy.mjs',...args], { cwd: resolve('.'), windowsHide: true,
        env: { ...process.env, REDEPLOY_DEVELOPMENT_URL: urls[0], REDEPLOY_PRODUCTION_URL: urls[1], REDEPLOY_TARGET_URL: target } });
      let output = ''; child.stdout.on('data',chunk => { output += chunk; }); child.stderr.on('data',chunk => { output += chunk; });
      child.once('error',reject); child.once('exit',code => accept({code,output}));
    });
    const prepare = async mode => {
      const result = await cli(['prepare','--mode',mode,...(mode==='merge'?['--writers-paused']:[])]);
      assert.equal(result.code,0,result.output);
      const folder = result.output.match(/Prepared (?:fresh|merge): (.+)/)[1].trim();
      const manifest = JSON.parse(await readFile(resolve(folder,'manifest.json'),'utf8'));
      names.push(manifest.id);
      return folder;
    };
    const freshBundle = await prepare('fresh');
    let result = await cli(['publish','--bundle',freshBundle,'--apply']);
    assert.equal(result.code,0,result.output);
    assert.equal((await fresh.query('SELECT count(*)::int AS n FROM account_users')).rows[0].n,0);
    assert.equal((await fresh.query('SELECT count(*)::int AS n FROM dictionary_entries')).rows[0].n,2);
    assert.equal((await fresh.query('SELECT count(*)::int AS n FROM future_private_table')).rows[0].n,0);
    assert.equal((await fresh.query("SELECT to_char(imported_at, 'US') AS fraction FROM dictionary_sources")).rows[0].fraction,'123456');
    result = await cli(['publish','--bundle',freshBundle,'--apply']);
    assert.notEqual(result.code,0); assert.match(result.output,/not empty/);
    const mergeBundle = await prepare('merge');
    assert.ok((await readdir(mergeBundle)).includes('users.dump'));
    result = await cli(['publish','--bundle',mergeBundle,'--apply','--writers-paused'],urls[3]);
    assert.equal(result.code,0,result.output);
    assert.deepEqual(await fingerprint(merged,protectedNames),before);
    // Bundle tampering is rejected before any target mutation.
    const dumpPath = resolve(mergeBundle,'candidate.dump');
    const original = await readFile(dumpPath);
    await writeFile(dumpPath,Buffer.concat([original,Buffer.from('tamper')]));
    result = await cli(['publish','--bundle',mergeBundle,'--apply','--writers-paused'],urls[3]);
    assert.notEqual(result.code,0); assert.match(result.output,/checksum mismatch/);
    await writeFile(dumpPath,original);
    await prod.query("UPDATE future_private_table SET payload='{}'");
    result = await cli(['publish','--bundle',mergeBundle,'--apply','--writers-paused'],urls[3]);
    assert.notEqual(result.code,0); assert.match(result.output,/changed since backup/);
    await dev.query('ALTER TABLE dictionary_entries ADD COLUMN incompatible text');
    await assert.rejects(mergePublic(dev,prod),/Schema mismatch/);
  } finally {
    await Promise.allSettled(clients.map(client => client.end()));
    // Only exact database names created by this test are eligible for cleanup.
    for (const name of names) {
      assert.match(name,/^lexiplay_(?:test_redeploy_\d+_(?:dev|prod|fresh|merged)|redeploy_\d+)$/);
      await admin.query(`DROP DATABASE IF EXISTS ${quote(name)} WITH (FORCE)`);
    }
    await admin.end();
  }
});
