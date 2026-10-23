import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function readJson<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

export async function fetchWebster<T>({ reference, key, terms, limit, parse }: {
  reference: 'collegiate' | 'thesaurus'; key: string; terms: string[]; limit: number;
  parse: (response: unknown, term: string) => T[];
}): Promise<T[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Request limit must be between 1 and 1000.');
  const folder = resolve(`.local-backups/merriam-webster-${reference}`);
  await mkdir(folder, { recursive: true });
  const lockPath = resolve(folder, 'fetch.lock');
  const lock = await open(lockPath, 'wx').catch(() => { throw new Error('Another import is running for this reference (fetch.lock).'); });
  try {
    const keyId = createHash('sha256').update(key).digest('hex').slice(0, 16);
    const usagePath = resolve(folder, `usage-${keyId}.json`);
    let usage = await readJson<{ day: string; requests: number }>(usagePath) ?? { day: '', requests: 0 };
    const items: T[] = [];
    let requested = 0, cached = 0;
    for (const term of terms) {
      const cachePath = resolve(folder, createHash('sha256').update(term).digest('hex') + '.json');
      let response = await readJson<unknown>(cachePath);
      if (response === undefined) {
        if (requested >= limit) break;
        const day = new Date().toISOString().slice(0, 10);
        if (usage.day !== day) usage = { day, requests: 0 };
        if (usage.requests >= 1000) { console.log('Daily importer budget reached; cached progress is preserved.'); break; }
        usage.requests++; requested++;
        await writeFile(usagePath, JSON.stringify(usage));
        let result: Response;
        try {
          result = await fetch(`https://www.dictionaryapi.com/api/v3/references/${reference}/json/${encodeURIComponent(term)}?key=${encodeURIComponent(key)}`,
            { signal: AbortSignal.timeout(15000) });
        } catch { throw new Error('Dictionary API request failed; cached results are preserved.'); }
        if (!result.ok) throw new Error(`Dictionary API returned HTTP ${result.status}; stopped without retrying.`);
        response = await result.json().catch(() => { throw new Error(`Dictionary API returned invalid JSON. Check the ${reference} key.`); });
        parse(response, term);
        await writeFile(cachePath, JSON.stringify(response));
      } else cached++;
      items.push(...parse(response, term));
    }
    console.log(JSON.stringify({ reference, requested, cached, items: items.length }));
    return items;
  } finally { await lock.close(); await unlink(lockPath); }
}
