import { FormEvent, useEffect, useRef, useState } from 'react';

type WordStatus = 'KNOWN' | 'UNFAMILIAR';
type WordEntry = { id: string; term: string; definition: string; partOfSpeech?: string | null; example?: string | null; status: WordStatus };
type PendingWordOperation =
  | { kind: 'create'; listId: string; term: string; definition: string }
  | { kind: 'dictionary-create'; listId: string; term: string }
  | { kind: 'update'; listId: string; term: string; definition: string }
  | { kind: 'delete'; listId: string };
type WordList = { id: string; name: string; words: WordEntry[] };
type DictionaryEntry = { term: string; definition: string; partOfSpeech: string[] };
type ImportRow = { rowNumber: number; term: string; definition: string; partOfSpeech: string | null; example: string | null; selected: boolean; issues: string[] };
type ImportPreview = { rows: ImportRow[]; totals: { ready: number; warnings: number; rejected: number } };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData)) headers.set('content-type', 'application/json');
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    credentials: 'same-origin',
    headers,
  });
  const payload = response.status === 204 ? undefined : await response.json();
  if (!response.ok) {
    if (response.status === 401) throw new Error('Sign in with the Account menu to manage your word lists.');
    throw new Error(payload?.message ?? 'Something went wrong. Please try again.');
  }
  return payload as T;
}

export default function WordListsPanel({ pageMode = false, searchQuery = '' }: { pageMode?: boolean; searchQuery?: string }) {
  const [lists, setLists] = useState<WordList[]>([]);
  const [term, setTerm] = useState('');
  const [definition, setDefinition] = useState('');
  const [editingWordId, setEditingWordId] = useState('');
  const [editingTerm, setEditingTerm] = useState('');
  const [editingDefinition, setEditingDefinition] = useState('');
  const [busy, setBusy] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [message, setMessage] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [listSearch, setListSearch] = useState(searchQuery);
  const [dictionaryResults, setDictionaryResults] = useState<DictionaryEntry[]>([]);
  const [dictionaryBusy, setDictionaryBusy] = useState(false);
  const pendingStatuses = useRef(new Map<string, { listId: string; status: WordStatus }>());
  const pendingWordOperations = useRef(new Map<string, PendingWordOperation>());

  useEffect(() => setListSearch(searchQuery), [searchQuery]);
  useEffect(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return;
    const match = lists.find(list => list.name.toLowerCase().includes(query)
      || list.words.some(word => `${word.term} ${word.definition}`.toLowerCase().includes(query)));
    if (match) setSelectedId(match.id);
  }, [searchQuery, lists]);
  useEffect(() => {
    const query = searchQuery.trim();
    let active = true;
    if (!query) { setDictionaryResults([]); return; }
    const timer = window.setTimeout(() => {
      setDictionaryBusy(true);
      request<DictionaryEntry[]>(`/word-lists/dictionary?q=${encodeURIComponent(query)}`)
        .then(results => { if (active) setDictionaryResults(results); })
        .catch(error => { if (active) setMessage(error instanceof Error ? error.message : 'Could not search the dictionary.'); })
        .finally(() => { if (active) setDictionaryBusy(false); });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [searchQuery]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setBusy(true);
    request<WordList[]>('/word-lists')
      .then(nextLists => { if (active) { setLists(nextLists); setSelectedId(nextLists[0]?.id ?? ''); setAuthenticated(true); setMessage(''); } })
      .catch(error => { if (active) setMessage(error instanceof Error ? error.message : 'Could not load your lists.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    async function flushPendingStatuses() {
      const createdIds = new Map<string, string>();
      for (const [wordId, operation] of pendingWordOperations.current) {
        try {
          if (operation.kind === 'create' || operation.kind === 'dictionary-create') {
            const created = operation.kind === 'create'
              ? await request<WordEntry>(`/word-lists/${operation.listId}/words`, {
                method: 'POST', body: JSON.stringify({ term: operation.term, definition: operation.definition }),
              })
              : await request<WordEntry>(`/word-lists/${operation.listId}/dictionary`, {
                method: 'POST', body: JSON.stringify({ term: operation.term }),
              });
            createdIds.set(wordId, created.id);
            pendingWordOperations.current.delete(wordId);
          } else if (operation.kind === 'update') {
            await request<WordEntry>(`/word-lists/${operation.listId}/words/${wordId}`, {
              method: 'PATCH', body: JSON.stringify({ term: operation.term, definition: operation.definition }),
            });
            pendingWordOperations.current.delete(wordId);
          } else {
            await request<void>(`/word-lists/${operation.listId}/words/${wordId}`, { method: 'DELETE' });
            pendingWordOperations.current.delete(wordId);
          }
        } catch (error) {
          setMessage(error instanceof Error ? error.message : 'Could not save your word list changes.');
        }
      }
      for (const [wordId, pending] of pendingStatuses.current) {
        if (pendingWordOperations.current.get(wordId)?.kind === 'create' || pendingWordOperations.current.get(wordId)?.kind === 'dictionary-create') continue;
        try {
          const serverWordId = createdIds.get(wordId) ?? wordId;
          const updated = await request<WordEntry>(`/word-lists/${pending.listId}/words/${serverWordId}`, {
            method: 'PATCH', body: JSON.stringify({ status: pending.status }),
          });
          setLists(current => current.map(list => list.id === pending.listId
            ? { ...list, words: list.words.map(word => word.id === wordId ? updated : word) }
            : list));
          if (pendingStatuses.current.get(wordId) === pending) pendingStatuses.current.delete(wordId);
        } catch (error) {
          setMessage(error instanceof Error ? error.message : 'Could not update the word status.');
        }
      }
    }
    window.addEventListener('lexiplay:before-route-change', flushPendingStatuses);
    return () => window.removeEventListener('lexiplay:before-route-change', flushPendingStatuses);
  }, []);

  async function submitWord(event: FormEvent<HTMLFormElement>, listId: string) {
    event.preventDefault();
    const id = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const word: WordEntry = { id, term: term.trim().toLowerCase(), definition: definition.trim(), status: 'UNFAMILIAR' };
    pendingWordOperations.current.set(id, { kind: 'create', listId, term: word.term, definition: word.definition });
    setLists(current => current.map(list => list.id === listId ? { ...list, words: [...list.words, word] } : list));
    setTerm('');
    setDefinition('');
  }

  function saveWord(event: FormEvent<HTMLFormElement>, listId: string, wordId: string) {
    event.preventDefault();
    const currentOperation = pendingWordOperations.current.get(wordId);
    if (currentOperation?.kind === 'create') {
      pendingWordOperations.current.set(wordId, { ...currentOperation, term: editingTerm.trim().toLowerCase(), definition: editingDefinition.trim() });
    } else if (currentOperation?.kind === 'dictionary-create') {
      pendingWordOperations.current.set(wordId, { kind: 'create', listId, term: editingTerm.trim().toLowerCase(), definition: editingDefinition.trim() });
    } else {
      pendingWordOperations.current.set(wordId, { kind: 'update', listId, term: editingTerm.trim().toLowerCase(), definition: editingDefinition.trim() });
    }
    setLists(current => current.map(list => list.id === listId ? { ...list, words: list.words.map(word => word.id === wordId ? { ...word, term: editingTerm.trim().toLowerCase(), definition: editingDefinition.trim() } : word) } : list));
    setEditingWordId('');
  }

  function addDictionaryWord(listId: string, entry: DictionaryEntry) {
    if (lists.some(list => list.id === listId && list.words.some(word => word.term === entry.term))) return;
    const id = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pendingWordOperations.current.set(id, { kind: 'dictionary-create', listId, term: entry.term });
    setLists(current => current.map(list => list.id === listId
      ? { ...list, words: [...list.words, { id, term: entry.term, definition: entry.definition, status: 'UNFAMILIAR', partOfSpeech: entry.partOfSpeech.join(', '), example: null }] }
      : list));
    setSelectedId(listId);
    setMessage(`${entry.term} added as unfamiliar.`);
  }
  async function changeWordStatus(listId: string, word: WordEntry) {
    const status: WordStatus = word.status === 'KNOWN' ? 'UNFAMILIAR' : 'KNOWN';
    const operation = pendingWordOperations.current.get(word.id);
    if ((operation?.kind === 'create' || operation?.kind === 'dictionary-create') && status === 'UNFAMILIAR') pendingStatuses.current.delete(word.id);
    else pendingStatuses.current.set(word.id, { listId, status });
    setLists(current => current.map(list => list.id === listId
      ? { ...list, words: list.words.map(item => item.id === word.id ? { ...item, status } : item) }
      : list));
  }

  function deleteWord(listId: string, wordId: string) {
    const operation = pendingWordOperations.current.get(wordId);
    if (operation?.kind === 'create' || operation?.kind === 'dictionary-create') pendingWordOperations.current.delete(wordId);
    else pendingWordOperations.current.set(wordId, { kind: 'delete', listId });
    pendingStatuses.current.delete(wordId);
    setLists(current => current.map(list => list.id === listId ? { ...list, words: list.words.filter(word => word.id !== wordId) } : list));
  }

  async function previewImport(listId: string) {
    if (!uploadFile) return;
    setBusy(true);
    setMessage('');
    setPreview(null);
    try {
      const form = new FormData();
      form.append('file', uploadFile);
      setPreview(await request<ImportPreview>(`/word-lists/${listId}/import-preview`, { method: 'POST', body: form }));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not preview this file.'); }
    finally { setBusy(false); }
  }

  async function confirmImport(listId: string) {
    if (!preview) return;
    const selectedCount = preview.rows.filter(row => row.selected).length;
    setBusy(true);
    setMessage('');
    try {
      const result = await request<{ added: number; duplicates: number }>(`/word-lists/${listId}/import`, {
        method: 'POST', body: JSON.stringify({ rows: preview.rows }),
      });
      const updated = await request<WordList>(`/word-lists/${listId}`);
      setLists(current => current.map(list => list.id === listId ? updated : list));
      setPreview(null);
      setUploadFile(null);
      setMessage(`${result.added} ${result.added === 1 ? 'word' : 'words'} added${result.duplicates ? `; ${result.duplicates} duplicate${result.duplicates === 1 ? '' : 's'} skipped` : ''}.`);
      if (!selectedCount && !result.added) setMessage('No words were selected for import.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not import these words.'); }
    finally { setBusy(false); }
  }

  const normalizedSearch = listSearch.trim().toLowerCase();
  const visibleLists = lists.filter(list => !normalizedSearch
    || list.name.toLowerCase().includes(normalizedSearch)
    || list.words.some(word => `${word.term} ${word.definition}`.toLowerCase().includes(normalizedSearch)));

  return <section className={`word-lists-panel${pageMode ? ' page-mode' : ''}`}>
    <div className="word-lists-content">
      {pageMode && authenticated && <div className="list-library-heading"><div><p className="eyebrow">YOUR VOCABULARY</p><h2>My word list</h2><p>Search the dictionary and keep track of what you know.</p></div></div>}

      {busy && !lists.length && <p className="account-message">Loading your lists…</p>}
      {!busy && authenticated && !lists.length && !message && <p className="account-message">Your lists will appear here.</p>}
      {normalizedSearch && lists.length > 0 && visibleLists.length === 0 && <p className="account-message" role="status">No saved words match “{listSearch}”.</p>}
      {normalizedSearch && <section className="dictionary-results" aria-label="Dictionary search results"><h3>Dictionary</h3>{dictionaryBusy && <p className="account-message">Searching…</p>}{!dictionaryBusy && dictionaryResults.length === 0 && <p className="account-message">No dictionary matches.</p>}{dictionaryResults.map(entry => {
        const list = lists[0];
        const alreadyAdded = list?.words.some(word => word.term === entry.term) ?? false;
        return <article className="dictionary-result" key={entry.term}><div><strong>{entry.term}</strong><span>{entry.definition}</span>{entry.partOfSpeech.length > 0 && <small>{entry.partOfSpeech.join(', ')}</small>}</div><button className="account-action" type="button" disabled={alreadyAdded || !list} onClick={() => list && addDictionaryWord(list.id, entry)}>{alreadyAdded ? 'Added' : 'Add to list'}</button></article>;
      })}</section>}
      {visibleLists.map(list => {
        const listMatches = list.name.toLowerCase().includes(normalizedSearch);
        const visibleWords = normalizedSearch && !listMatches
          ? list.words.filter(word => `${word.term} ${word.definition}`.toLowerCase().includes(normalizedSearch))
          : list.words;
        return <article className="word-list-card" key={list.id}>
        <div className="word-list-heading">
          <div className="word-list-select">
              <span><h3>{list.name}</h3></span>
            <span className="word-list-count">{list.words.length} words</span>
          </div>
        </div>

        <div className="word-list-detail">
          <section className="word-import" aria-label="Edit words">
            <button className="account-action upload-toggle" type="button" aria-expanded={uploadOpen} onClick={() => setUploadOpen(value => !value)}>{uploadOpen ? 'Close upload' : 'Upload words'}</button>
            {uploadOpen && <div className="upload-interface">
            <h4>Import a word list</h4>
            <p>Upload TXT, DOCX, CSV, XLSX, or PDF. Use one word per line or include a definition after a dash or colon.</p>
            <label htmlFor={`import-file-${list.id}`}>Choose a file</label>
            <input id={`import-file-${list.id}`} aria-label="Upload word list" type="file" accept=".txt,.docx,.csv,.xlsx,.pdf,application/pdf" onChange={event => { setUploadFile(event.target.files?.[0] ?? null); setPreview(null); }} />
            <button className="account-action" type="button" onClick={() => void previewImport(list.id)} disabled={busy || !uploadFile}> {busy ? 'Working…' : 'Preview import'}</button>
            {preview && <>
              <p className="import-summary" role="status">{preview.totals.ready} ready · {preview.totals.warnings} duplicate warnings · {preview.totals.rejected} need attention</p>
              <div className="import-preview-table" role="table" aria-label="Import preview">
                {preview.rows.map((row, index) => <div className="import-preview-row" role="row" key={`${row.rowNumber}-${index}`}>
                  <label><input type="checkbox" aria-label={`Include ${row.term || `row ${row.rowNumber}`}`} checked={row.selected} disabled={Boolean(row.issues.some(issue => issue === 'INVALID_TERM' || issue === 'MISSING_TERM'))} onChange={event => setPreview(current => current ? { ...current, rows: current.rows.map((item, itemIndex) => itemIndex === index ? { ...item, selected: event.target.checked } : item) } : current)} /></label>
                  <strong>{row.term || `Row ${row.rowNumber}`}</strong><span>{row.definition || 'No definition'}</span>
                  {row.issues.length > 0 && <small>{row.issues.map(issue => issue === 'INVALID_TERM' ? 'Use letters, spaces, or hyphens' : issue === 'MISSING_TERM' ? 'Word is missing' : issue === 'DUPLICATE_IN_FILE' ? 'Repeated in file' : 'Already in list').join(' · ')}</small>}
                </div>)}
                {!preview.rows.length && <p>No words were found in this file.</p>}
              </div>
              <button className="account-action" type="button" onClick={() => void confirmImport(list.id)} disabled={busy || !preview.rows.some(row => row.selected)}>Import {preview.rows.filter(row => row.selected).length} {preview.rows.filter(row => row.selected).length === 1 ? 'word' : 'words'}</button>
            </>}
            </div>}

          <form className="word-add-form" onSubmit={event => submitWord(event, list.id)}>
            <h4>Add a word</h4>
            <label htmlFor={`word-term-${list.id}`}>Word</label>
            <input id={`word-term-${list.id}`} value={term} onChange={event => setTerm(event.target.value)} required maxLength={100} pattern="[A-Za-z][A-Za-z '-]{0,99}" />
            <label htmlFor={`word-definition-${list.id}`}>Definition</label>
            <input id={`word-definition-${list.id}`} value={definition} onChange={event => setDefinition(event.target.value)} maxLength={500} />
            <button className="account-action" type="submit">Add word</button>
          </form>
          <ul className="word-entry-list">
            {visibleWords.map(word => <li key={word.id}>
              {editingWordId === word.id ? <form className="word-edit-form" onSubmit={event => saveWord(event, list.id, word.id)}>
                <label htmlFor={`edit-term-${word.id}`}>Word</label>
                <input id={`edit-term-${word.id}`} value={editingTerm} onChange={event => setEditingTerm(event.target.value)} required maxLength={100} pattern="[A-Za-z][A-Za-z '-]{0,99}" />
                <label htmlFor={`edit-definition-${word.id}`}>Definition</label>
                <input id={`edit-definition-${word.id}`} value={editingDefinition} onChange={event => setEditingDefinition(event.target.value)} maxLength={500} />
                <button className="text-action" type="submit">Save</button>
                <button className="text-action" type="button" onClick={() => setEditingWordId('')}>Cancel</button>
                <button className="text-action remove-word-action" type="button" onClick={() => { deleteWord(list.id, word.id); setEditingWordId(''); }}>Remove word</button>
              </form> : <>
                <span><strong>{word.term}</strong><small>{word.definition || 'No definition yet'}</small></span>
                <button className={`word-status ${word.status === 'KNOWN' ? 'known' : 'unfamiliar'}`} type="button" aria-pressed={word.status === 'KNOWN'} onClick={() => void changeWordStatus(list.id, word)}>{word.status === 'KNOWN' ? 'Known' : 'Unfamiliar'}</button>
                <button className="text-action" type="button" onClick={() => { setEditingWordId(word.id); setEditingTerm(word.term); setEditingDefinition(word.definition); }}>Edit</button>
              </>}
            </li>)}
          </ul>
          </section>
        </div>
      </article>;
      })}
      {message && <p className="account-message" role="status">{message}</p>}
    </div>
  </section>;
}
