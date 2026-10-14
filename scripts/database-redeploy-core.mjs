import { randomUUID, createHash } from 'node:crypto';

// Everything outside this allowlist is private, including future tables.
export const PUBLIC_TABLES = {
  dictionary_words: ['term'],
  dictionary_sources: ['id'],
  dictionary_source_words: ['source_id', 'term'],
  dictionary_entries: ['normalized_lemma', 'part_of_speech'],
  dictionary_definitions: ['dictionary_entry_id', 'language', 'sense_index'],
  vocabulary_collections: ['slug'],
  collection_entries: ['collection_id', 'dictionary_entry_id'],
  game_word_pools: ['id'],
};
export const quote = value => `"${value.replaceAll('"', '""')}"`;
export function databaseIdentity(connection) {
  const url = new URL(connection);
  const host = ['localhost', '127.0.0.1', '[::1]', 'host.docker.internal'].includes(url.hostname) ? 'localhost' : url.hostname.toLowerCase();
  return `${host}:${url.port || '5432'}/${decodeURIComponent(url.pathname.slice(1))}`;
}
export function distinctDatabases(...connections) {
  const identities = connections.filter(Boolean).map(databaseIdentity);
  if (new Set(identities).size !== identities.length) throw new Error('Source, candidate and target must be different databases.');
}
export async function tables(client) {
  return (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row => row.tablename);
}
export async function fingerprint(client, names = undefined) {
  const result = {};
  for (const name of names ?? await tables(client)) {
    const row = (await client.query(`SELECT count(*)::text AS count, md5(COALESCE(string_agg(h, '' ORDER BY h), '')) AS hash FROM (SELECT md5(row_to_json(t)::text) AS h FROM public.${quote(name)} t) rows`)).rows[0];
    result[name] = row;
  }
  return result;
}
export function equalFingerprint(a, b) {
  const names = Object.keys(a).sort();
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(b).sort())) return false;
  // Prisma and pg can return the same columns in different JS property order.
  return names.every(name => String(a[name].count) === String(b[name].count) && a[name].hash === b[name].hash);
}
export async function assertEmpty(client) {
  const { rows } = await client.query("SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%' AND c.relkind IN ('r','p','v','m','S','f') LIMIT 1");
  if (rows.length) throw new Error('Destination is not empty. Create a new database; existing databases are never cleared.');
}
async function shape(client) {
  return (await client.query("SELECT table_name,column_name,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,column_name")).rows;
}
export async function assertCompatible(source, candidate, { previewHistoryMismatch = false } = {}) {
  if (JSON.stringify(await shape(source)) !== JSON.stringify(await shape(candidate))) {
    throw new Error('Schema mismatch. Migrate a production clone to the development schema before preparing a merge.');
  }
  const names = await tables(source);
  if (names.includes('_prisma_migrations')) {
    const query = 'SELECT migration_name,checksum FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name';
    const sourceHistory = (await source.query(query)).rows;
    const candidateHistory = (await candidate.query(query)).rows;
    if (JSON.stringify(sourceHistory) !== JSON.stringify(candidateHistory) && !(previewHistoryMismatch && JSON.stringify(sourceHistory.map(row => row.migration_name)) === JSON.stringify(candidateHistory.map(row => row.migration_name)))) {
      throw new Error('Migration histories differ. Resolve migrations on a production clone before merging.');
    }
  }
}
export async function upsert(client, name, rows, keys) {
  if (!rows.length) return;
  const columns = Object.keys(rows[0]);
  const update = columns.filter(column => !keys.includes(column) && column !== 'id');
  const conflict = update.length ? `DO UPDATE SET ${update.map(column => `${quote(column)}=EXCLUDED.${quote(column)}`).join(',')}` : 'DO NOTHING';
  for (let start = 0; start < rows.length; start += 500) {
    await client.query(`INSERT INTO public.${quote(name)} (${columns.map(quote).join(',')}) SELECT ${columns.map(quote).join(',')} FROM jsonb_populate_recordset(NULL::public.${quote(name)}, $1::jsonb) ON CONFLICT (${keys.map(quote).join(',')}) ${conflict}`, [JSON.stringify(rows.slice(start, start + 500))]);
  }
}
// Use natural keys, retaining target IDs so bookmarks, progress and word lists keep their references.
export async function mergePublic(source, candidate, { fresh = false, previewHistoryMismatch = false, transactionManaged = false } = {}) {
  if (!fresh) await assertCompatible(source, candidate, { previewHistoryMismatch });
  const available = await tables(source);
  const protectedNames = (await tables(candidate)).filter(name => !Object.hasOwn(PUBLIC_TABLES, name));
  const before = await fingerprint(candidate, protectedNames);
  const mappings = {};
  const report = {};
  if (!transactionManaged) await candidate.query('BEGIN');
  try {
    for (const [name, keys] of Object.entries(PUBLIC_TABLES)) {
      if (!available.includes(name)) continue;
      const rows = (await source.query(`SELECT * FROM public.${quote(name)}`)).rows;
      if (name === 'dictionary_entries' || name === 'vocabulary_collections') {
        const key = row => JSON.stringify(keys.map(column => row[column]));
        const existing = new Map((await candidate.query(`SELECT * FROM public.${quote(name)}`)).rows.map(row => [key(row), row.id]));
        mappings[name] = new Map();
        for (const row of rows) {
          const oldId = row.id;
          row.id = existing.get(key(row)) ?? randomUUID();
          mappings[name].set(oldId, row.id);
        }
      }
      if (name === 'dictionary_definitions' || name === 'collection_entries') {
        for (const row of rows) {
          row.dictionary_entry_id = mappings.dictionary_entries?.get(row.dictionary_entry_id);
          if (!row.dictionary_entry_id) throw new Error('Unmapped dictionary entry.');
          if (name === 'collection_entries') {
            row.collection_id = mappings.vocabulary_collections?.get(row.collection_id);
            if (!row.collection_id) throw new Error('Unmapped collection.');
          }
        }
        if (name === 'dictionary_definitions') {
          const key = row => JSON.stringify(keys.map(column => row[column]));
          const existing = new Map((await candidate.query(`SELECT * FROM public.${quote(name)}`)).rows.map(row => [key(row), row.id]));
          for (const row of rows) row.id = existing.get(key(row)) ?? randomUUID();
        }
      }
      await upsert(candidate, name, rows, keys);
      report[name] = rows.length;
    }
    if (fresh && available.includes('_prisma_migrations')) {
      await upsert(candidate, '_prisma_migrations', (await source.query('SELECT * FROM public._prisma_migrations')).rows, ['id']);
    }
    if (!fresh && !equalFingerprint(before, await fingerprint(candidate, protectedNames))) throw new Error('Protected user data changed; merge rolled back.');
    if (!transactionManaged) await candidate.query('COMMIT');
  } catch (error) { if (!transactionManaged) await candidate.query('ROLLBACK'); throw error; }
  return report;
}
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
