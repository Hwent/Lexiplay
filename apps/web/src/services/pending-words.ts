import { apiRequest } from './api-client';
import { LibraryRequests } from './library-requests';

type PendingWord = { term: string; definition: string; listId?: string };
export type WordSelection = { saved: ReadonlySet<string>; pending: ReadonlySet<string>; saving: boolean; ready: boolean; error: string; notice: string };
const LOCAL_WORDS = 'lexiplay-local-word-lists';
const normalize = (term: string) => term.trim();

export class PendingWords {
  readonly requests = new LibraryRequests();
  private words = new Map<string, PendingWord>();
  private listeners = new Set<() => void>();
  private state: WordSelection = { saved: new Set(), pending: new Set(), saving: false, ready: false, error: '', notice: '' };
  private saving: Promise<void> | undefined;
  private reading: Promise<void> | undefined;
  private savedRevision = 0;
  private readonly storageKey: string;

  constructor(readonly owner: string) {
    this.storageKey = 'lexiplay-pending-words:' + owner;
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(this.storageKey) ?? '[]');
      if (Array.isArray(stored)) for (const word of stored) {
        if (typeof word?.term === 'string' && word.term.trim() && word.term.length <= 100) {
          const term = normalize(word.term);
          this.words.set(term, { term, definition: typeof word.definition === 'string' ? word.definition : '', ...(typeof word.listId === 'string' ? { listId: word.listId } : {}) });
        }
      }
    } catch { /* A damaged draft does not prevent a new selection. */ }
    this.state = { ...this.state, pending: new Set(this.words.keys()) };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<WordSelection> = {}) {
    this.state = { ...this.state, ...patch, pending: new Set(this.words.keys()) };
    this.listeners.forEach(listener => listener());
  }
  private persist() {
    try {
      if (this.words.size) localStorage.setItem(this.storageKey, JSON.stringify([...this.words.values()]));
      else localStorage.removeItem(this.storageKey);
      return true;
    } catch { this.publish({ error: 'Pending words could not be kept on this device. Leave this page to save them before closing it.' }); return false; }
  }
  loadSaved(force = false): Promise<void> {
    if (this.reading) return force ? this.reading.catch(() => {}).then(() => this.loadSaved(true)) : this.reading;
    if (force) { this.requests.invalidate('/word-lists/saved-terms'); this.savedRevision++; }
    const revision = this.savedRevision;
    const read = (async () => {
      let terms: string[];
      if (this.owner === 'guest') {
        const lists = JSON.parse(localStorage.getItem(LOCAL_WORDS) ?? '[]') as { words: { term: string }[] }[];
        terms = lists.flatMap(list => list.words.map(word => normalize(word.term)));
      } else {
        const value = await this.requests.get<{ terms: string[] }>('/word-lists/saved-terms');
        if (!Array.isArray(value.terms)) throw new Error('Could not load your saved words.');
        terms = value.terms.map(normalize);
      }
      if (revision !== this.savedRevision) return;
      const saved = new Set(terms);
      for (const term of saved) this.words.delete(term);
      this.persist();
      this.publish({ saved, ready: true });
    })().finally(() => { if (this.reading === read) this.reading = undefined; });
    this.reading = read;
    return read;
  }
  toggle(term: string, definition = '', listId?: string) {
    term = normalize(term);
    if (!term || this.state.saving || this.state.saved.has(term)) return;
    if (this.words.has(term)) this.words.delete(term);
    else this.words.set(term, { term, definition, ...(listId ? { listId } : {}) });
    const persisted = this.persist(); this.publish({ ...(persisted ? { error: '' } : {}), notice: '' });
  }
  stage(terms: string[], listId?: string) {
    if (this.state.saving) return 0;
    let added = 0;
    for (const raw of terms) {
      const term = normalize(raw);
      if (term && !this.state.saved.has(term) && !this.words.has(term)) { this.words.set(term, { term, definition: '', ...(listId ? { listId } : {}) }); added++; }
    }
    const persisted = this.persist(); this.publish({ ...(persisted ? { error: '' } : {}), notice: '' });
    return added;
  }
  cancelAll() {
    if (this.state.saving) return;
    this.words.clear(); const persisted = this.persist(); this.publish({ ...(persisted ? { error: '' } : {}), notice: '' });
  }
  invalidateWords() {
    this.requests.invalidate('/word-lists');
    this.requests.invalidate('/collections/');
  }
  flush(keepalive = false): Promise<void> {
    if (this.saving) return this.saving;
    if (!this.words.size) return Promise.resolve();
    this.publish({ saving: true, error: '', notice: '' });
    const save = (async () => {
      if (!this.state.ready) await this.loadSaved();
      if (this.owner === 'guest') {
        const lists = JSON.parse(localStorage.getItem(LOCAL_WORDS) ?? '[]') as { id: string; name: string; words: { id: string; term: string; definition: string; status: string }[] }[];
        const list = lists[0] ?? { id: '00000000-0000-4000-8000-000000000001', name: 'My words', words: [] };
        const saved = new Set(this.state.saved);
        for (const word of this.words.values()) {
          if (!saved.has(word.term)) list.words.push({ id: crypto.randomUUID(), term: word.term, definition: word.definition, status: 'UNFAMILIAR' });
          saved.add(word.term);
        }
        localStorage.setItem(LOCAL_WORDS, JSON.stringify([list]));
        this.words.clear(); this.persist(); this.publish({ saved, notice: 'Selected words saved on this device.' });
        return;
      }
      let listId = [...this.words.values()].find(word => word.listId)?.listId;
      if (this.words.size && !listId) {
        const lists = await this.requests.get<{ id: string; isDefault: boolean }[]>('/word-lists/mine');
        listId = lists.find(list => list.isDefault)?.id ?? lists[0]?.id;
        if (!listId) throw new Error('Your word list is unavailable.');
      }
      const missing: string[] = [];
      let count = 0;
      while (this.words.size) {
        const terms: string[] = [];
        for (const term of this.words.keys()) {
          terms.push(term);
          if (terms.length === 200) break;
        }
        const result = await apiRequest<{ added: number; skipped: number; missing: string[] }>(`/word-lists/${listId}/dictionary-entries`, { method: 'POST', body: JSON.stringify({ terms }), keepalive });
        if (!Array.isArray(result.missing)) throw new Error('Could not confirm that your words were saved.');
        const rejected = new Set(result.missing);
        const saved = new Set(this.state.saved);
        for (const term of terms) { this.words.delete(term); if (!rejected.has(term)) saved.add(term); }
        missing.push(...result.missing); count += result.added;
        const lists = this.requests.peek<{ id: string; wordCount?: number }[]>('/word-lists/mine');
        this.savedRevision++;
        this.requests.invalidate('/word-lists/mine');
        this.requests.invalidate('/word-lists/saved-terms');
        this.requests.invalidate(`/word-lists/${listId}/entries`);
        this.requests.invalidate('/collections/');
        this.requests.prime('/word-lists/saved-terms', { terms: [...saved] });
        if (lists) this.requests.prime('/word-lists/mine', lists.map(list => list.id === listId && typeof list.wordCount === 'number' ? { ...list, wordCount: list.wordCount + result.added } : list));
        this.persist(); this.publish({ saved, ready: true });
      }
      this.publish({ notice: missing.length ? `Dictionary definitions were unavailable for: ${missing.join(', ')}. These words were skipped.` : `${count} dictionary ${count === 1 ? 'entry' : 'entries'} saved.` });
    })().catch(cause => {
      this.persist(); this.publish({ error: (cause instanceof Error ? cause.message : 'Could not save your words.') + ' Your selections are still pending. Try leaving the page again.' });
      throw cause;
    }).finally(() => { this.saving = undefined; this.publish({ saving: false }); });
    this.saving = save;
    return save;
  }
}
