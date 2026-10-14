import { apiRequest } from './services/api-client';

export type DictionaryEntry = { term: string; definition?: string; partOfSpeech: string[]; senses?: { partOfSpeech: string; definitions: string[] }[] };
type Cached<T> = { value: T; expiresAt: number };
const STORAGE_KEY = 'lexiplay-dictionary-cache-v5-wordnet-2025';
const CACHE_LIFETIME = 24 * 60 * 60 * 1000;
const searches = new Map<string, Cached<DictionaryEntry[]>>();
const definitions = new Map<string, Cached<string>>();
const pending = new Map<string, Promise<unknown>>();
let loaded = false;

export const normalizeTerm = (term: string) => term.trim().toLowerCase();

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const data = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    for (const [key, entry] of data.searches ?? []) {
      if (typeof key === 'string' && entry.expiresAt > Date.now() && Array.isArray(entry.value)
        && entry.value.every((word: DictionaryEntry) => typeof word?.term === 'string' && Array.isArray(word.partOfSpeech))) searches.set(key, entry);
    }
    for (const [key, entry] of data.definitions ?? []) {
      if (typeof key === 'string' && entry.expiresAt > Date.now() && typeof entry.value === 'string') definitions.set(key, entry);
    }
  } catch { /* A missing or invalid cache must not prevent API requests. */ }
}

function persist() {
  for (const cache of [searches, definitions]) {
    for (const [key, entry] of cache) if (entry.expiresAt <= Date.now()) cache.delete(key);
    const limit = cache === searches ? 100 : 300;
    while (cache.size > limit) cache.delete(cache.keys().next().value!);
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ searches: [...searches], definitions: [...definitions] }));
  } catch { /* Keep using the in-memory cache when browser storage is unavailable. */ }
}

function cached<T>(cache: Map<string, Cached<T>>, key: string): T | undefined {
  load();
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) { cache.delete(key); return undefined; }
  return entry.value;
}

async function request<T>(path: string): Promise<T> {
  return apiRequest<T>(`/word-lists/${path}`, undefined, 'Could not load the dictionary.');
}

function sharedRequest<T>(key: string, fetchValue: () => Promise<T>): Promise<T> {
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  const promise = fetchValue().finally(() => { pending.delete(key); });
  pending.set(key, promise);
  return promise;
}

export function cachedDictionaryDefinition(term: string) {
  return cached(definitions, term.trim());
}

// Only canonical dictionary/API game definitions belong here, never personal notes.
export function rememberDictionaryDefinition(term: string, definition: string) {
  if (!definition.trim()) return;
  load();
  definitions.set(term.trim(), { value: definition, expiresAt: Date.now() + CACHE_LIFETIME });
  persist();
}

export function searchDictionary(query: string): Promise<DictionaryEntry[]> {
  const normalized = normalizeTerm(query);
  const hit = cached(searches, normalized);
  if (hit !== undefined) return Promise.resolve(hit);
  return sharedRequest(`search:${normalized}`, async () => {
    const words = await request<DictionaryEntry[]>(`dictionary?q=${encodeURIComponent(normalized)}`);
    // A term can appear only once even if a provider returns duplicate matches.
    const results = [...new Map(words.map(word => [word.term, word])).values()];
    searches.set(normalized, { value: results, expiresAt: Date.now() + CACHE_LIFETIME });
    for (const word of results) if (word.definition) rememberDictionaryDefinition(word.term, word.definition);
    persist();
    return results;
  });
}

export function dictionaryDefinition(term: string): Promise<string> {
  const normalized = term.trim();
  const hit = cachedDictionaryDefinition(normalized);
  if (hit !== undefined) return Promise.resolve(hit);
  return sharedRequest(`definition:${normalized}`, async () => {
    const result = await request<{ definition: string }>(`dictionary/${encodeURIComponent(normalized)}/definition`);
    rememberDictionaryDefinition(normalized, result.definition);
    return result.definition;
  });
}

export function clearDictionaryCache() {
  searches.clear();
  definitions.clear();
  loaded = false;
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be disabled. */ }
}
