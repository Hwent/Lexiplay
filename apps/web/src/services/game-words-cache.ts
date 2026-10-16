import { apiRequest } from './api-client';

type Snapshot = { version: string; wordLength: number; words: string[] };
const storageKey = (length: number) => `lexiplay-game-words:${length}`;

function valid(value: Snapshot | null, length: number, version: string): value is Snapshot {
  const pattern = new RegExp(`^[a-z]{${length}}$`);
  return value?.version === version && value.wordLength === length && Array.isArray(value.words)
    && value.words.every(word => typeof word === 'string' && pattern.test(word));
}

export class GameWordsCache {
  private values = new Map<number, { version: string; words: ReadonlySet<string> }>();
  private pending = new Map<string, Promise<void>>();

  allows(word: string, version: string): boolean | undefined {
    const cached = this.values.get(word.length);
    return cached?.version === version ? cached.words.has(word) : undefined;
  }

  load(length: number, version: string): Promise<void> {
    if (this.values.get(length)?.version === version) return Promise.resolve();
    const key = `${version}:${length}`;
    const active = this.pending.get(key);
    if (active) return active;
    const request = (async () => {
      let cached: Snapshot | null = null;
      try { cached = JSON.parse(localStorage.getItem(storageKey(length)) ?? 'null'); } catch { /* Browser storage is optional. */ }
      const snapshot = valid(cached, length, version) ? cached
        : await apiRequest<Snapshot>(`/word-lists/dictionary/game-words?wordLength=${length}`);
      if (!valid(snapshot, length, version)) return;
      this.values.set(length, { version, words: new Set(snapshot.words) });
      try { localStorage.setItem(storageKey(length), JSON.stringify(snapshot)); } catch { /* Keep the in-memory cache when storage is full or unavailable. */ }
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }
}
