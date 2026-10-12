import { FormEvent, useEffect, useRef, useState } from 'react';
import { dictionaryDefinition, DictionaryEntry, normalizeTerm, searchDictionary } from './dictionary-cache';
import { ApiError, apiRequest as request } from './services/api-client';

type WordStatus = 'KNOWN' | 'UNFAMILIAR';
type WordEntry = { id: string; term: string; definition: string; partOfSpeech?: string | null; status: WordStatus };
type PendingWordOperation =
  | { kind: 'create'; listId: string; term: string; definition: string }
  | { kind: 'dictionary-create'; listId: string; term: string }
  | { kind: 'update'; listId: string; term: string; definition: string }
  | { kind: 'delete'; listId: string };
type WordList = { id: string; name: string; words: WordEntry[] };
type ImportRow = { rowNumber: number; term: string; definition: string; partOfSpeech: string | null; selected: boolean; issues: string[] };
type ImportPreview = { rows: ImportRow[]; totals: { ready: number; warnings: number; rejected: number } };
const LOCAL_WORD_LISTS_KEY = 'lexiplay-local-word-lists';

function loadLocalLists(): WordList[] {
  try {
    const stored = window.localStorage.getItem(LOCAL_WORD_LISTS_KEY);
    const lists = stored ? JSON.parse(stored) as WordList[] : [];
    if (Array.isArray(lists) && lists.length > 0 && lists.every(list => typeof list.id === 'string' && Array.isArray(list.words))) return lists;
  } catch { /* Use an empty local list when storage is missing or invalid. */ }
  return [{ id: '00000000-0000-4000-8000-000000000001', name: 'My words', words: [] }];
}

function savedDefinition(value: string) {
  const valueTrimmed = value.trim();
  const firstSemicolon = valueTrimmed.indexOf(';');
  const secondSemicolon = firstSemicolon < 0 ? -1 : valueTrimmed.indexOf(';', firstSemicolon + 1);
  const trimmed = secondSemicolon < 0 ? valueTrimmed : valueTrimmed.slice(0, secondSemicolon + 1).trim();
  return trimmed.length > 500 ? `${trimmed.slice(0, 499).trimEnd()}…` : trimmed;
}

function BookmarkIcon({ added }: { added: boolean }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 3.75h12a1 1 0 0 1 1 1v16l-7-4.5-7 4.5v-16a1 1 0 0 1 1-1Z" fill={added ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>;
}

export default function WordListsPanel({ pageMode = false, searchQuery = '' }: { pageMode?: boolean; searchQuery?: string }) {
  const [lists, setLists] = useState<WordList[]>(loadLocalLists);
  const [term, setTerm] = useState('');
  const [definition, setDefinition] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editingWordId, setEditingWordId] = useState('');
  const [editingTerm, setEditingTerm] = useState('');
  const [editingDefinition, setEditingDefinition] = useState('');
  const [busy, setBusy] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [localOnly, setLocalOnly] = useState(false);
  const [message, setMessage] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [listSearch, setListSearch] = useState(searchQuery);
  const [wordPage, setWordPage] = useState(1);
  const [dictionaryResults, setDictionaryResults] = useState<DictionaryEntry[]>([]);
  const [dictionaryBusy, setDictionaryBusy] = useState(false);
  const [dictionaryDefinitions, setDictionaryDefinitions] = useState<Record<string, string>>({});
  const [definitionBusyTerms, setDefinitionBusyTerms] = useState<Set<string>>(() => new Set());
  const pendingStatuses = useRef(new Map<string, { listId: string; status: WordStatus }>());
  const pendingWordOperations = useRef(new Map<string, PendingWordOperation>());

  useEffect(() => setListSearch(searchQuery), [searchQuery]);
  useEffect(() => { setWordPage(1); setDictionaryDefinitions({}); }, [searchQuery]);
  useEffect(() => {
    const query = normalizeTerm(searchQuery);
    let active = true;
    if (query.length < 2) { setDictionaryResults([]); setDictionaryBusy(false); return; }
    setDictionaryBusy(true);
    setDictionaryResults([]);
    const timer = window.setTimeout(() => {
      searchDictionary(query)
        .then(results => { if (active) setDictionaryResults(results); })
        .catch(error => { if (active) setMessage(error instanceof Error ? error.message : 'Could not search the dictionary.'); })
        .finally(() => { if (active) setDictionaryBusy(false); });
    }, 400);
    return () => { active = false; window.clearTimeout(timer); };
  }, [searchQuery]);
  useEffect(() => {
    let active = true;
    setBusy(true);
    request<WordList[]>('/word-lists')
      .then(nextLists => { if (active) { setLists(nextLists); setAuthenticated(true); setLocalOnly(false); setMessage(''); } })
      .catch(error => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          setLists(loadLocalLists());
          setLocalOnly(true);
          setMessage('');
        } else setMessage(error instanceof Error ? error.message : 'Could not load your lists.');
      })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (localOnly) window.localStorage.setItem(LOCAL_WORD_LISTS_KEY, JSON.stringify(lists));
  }, [lists, localOnly]);

  useEffect(() => {
    async function flushPendingStatuses() {
      if (localOnly) return;
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
  }, [localOnly]);

  async function submitWord(event: FormEvent<HTMLFormElement>, listId: string) {
    event.preventDefault();
    if (lists.some(list => list.id === listId && list.words.some(word => normalizeTerm(word.term) === normalizeTerm(term)))) {
      setMessage('This word is already in your list. Your saved definition has been kept.');
      return;
    }
    const id = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const word: WordEntry = { id, term: term.trim().toLowerCase(), definition: savedDefinition(definition), status: 'UNFAMILIAR' };
    if (!localOnly) pendingWordOperations.current.set(id, { kind: 'create', listId, term: word.term, definition: word.definition });
    setLists(current => current.map(list => list.id === listId ? { ...list, words: [...list.words, word] } : list));
    setTerm('');
    setDefinition('');
  }

  function saveWord(event: FormEvent<HTMLFormElement>, listId: string, wordId: string) {
    event.preventDefault();
    if (lists.some(list => list.id === listId && list.words.some(word => word.id !== wordId && normalizeTerm(word.term) === normalizeTerm(editingTerm)))) {
      setMessage('This word is already in your list. Choose a different word.');
      return;
    }
    const currentOperation = pendingWordOperations.current.get(wordId);
    if (localOnly) {
      pendingWordOperations.current.delete(wordId);
    } else if (currentOperation?.kind === 'create') {
      pendingWordOperations.current.set(wordId, { ...currentOperation, term: editingTerm.trim().toLowerCase(), definition: savedDefinition(editingDefinition) });
    } else if (currentOperation?.kind === 'dictionary-create') {
      pendingWordOperations.current.set(wordId, { kind: 'create', listId, term: editingTerm.trim().toLowerCase(), definition: savedDefinition(editingDefinition) });
    } else {
      pendingWordOperations.current.set(wordId, { kind: 'update', listId, term: editingTerm.trim().toLowerCase(), definition: savedDefinition(editingDefinition) });
    }
    setLists(current => current.map(list => list.id === listId ? { ...list, words: list.words.map(word => word.id === wordId ? { ...word, term: editingTerm.trim().toLowerCase(), definition: savedDefinition(editingDefinition) } : word) } : list));
    setEditingWordId('');
  }

  function addDictionaryWord(listId: string, entry: DictionaryEntry) {
    if (lists.some(list => list.id === listId && list.words.some(word => normalizeTerm(word.term) === normalizeTerm(entry.term)))) return;
    const id = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (!localOnly) pendingWordOperations.current.set(id, { kind: 'dictionary-create', listId, term: entry.term });
    setLists(current => current.map(list => list.id === listId
      ? { ...list, words: [...list.words, { id, term: entry.term, definition: savedDefinition(entry.definition ?? ''), status: 'UNFAMILIAR', partOfSpeech: entry.partOfSpeech.join(', ') }] }
      : list));
    setMessage(`${entry.term} added as unfamiliar.`);
  }

  async function loadDictionaryDefinition(term: string) {
    if (dictionaryDefinitions[term] !== undefined || definitionBusyTerms.has(term)) return;
    setDefinitionBusyTerms(current => new Set(current).add(term));
    try {
      const definition = await dictionaryDefinition(term);
      setDictionaryDefinitions(current => ({ ...current, [term]: definition }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load this definition.');
    } finally {
      setDefinitionBusyTerms(current => { const next = new Set(current); next.delete(term); return next; });
    }
  }
  async function changeWordStatus(listId: string, word: WordEntry) {
    const status: WordStatus = word.status === 'KNOWN' ? 'UNFAMILIAR' : 'KNOWN';
    const operation = pendingWordOperations.current.get(word.id);
    if ((operation?.kind === 'create' || operation?.kind === 'dictionary-create') && status === 'UNFAMILIAR') pendingStatuses.current.delete(word.id);
    else if (!localOnly) pendingStatuses.current.set(word.id, { listId, status });
    setLists(current => current.map(list => list.id === listId
      ? { ...list, words: list.words.map(item => item.id === word.id ? { ...item, status } : item) }
      : list));
  }

  function deleteWord(listId: string, wordId: string) {
    const operation = pendingWordOperations.current.get(wordId);
    if (localOnly || operation?.kind === 'create' || operation?.kind === 'dictionary-create') pendingWordOperations.current.delete(wordId);
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
    if (localOnly) {
      const selectedRows = preview.rows.filter(row => row.selected);
      let added = 0;
      const updatedLists = lists.map(list => {
        if (list.id !== listId) return list;
        const existingTerms = new Set(list.words.map(word => normalizeTerm(word.term)));
        const addedWords = selectedRows.filter(row => {
          const term = normalizeTerm(row.term);
          if (existingTerms.has(term)) return false;
          existingTerms.add(term);
          return true;
        }).map(row => ({
          id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          term: row.term.trim().toLowerCase(), definition: savedDefinition(row.definition),
          partOfSpeech: row.partOfSpeech, status: 'UNFAMILIAR' as const,
        }));
        added = addedWords.length;
        return { ...list, words: [...list.words, ...addedWords] };
      });
      setLists(updatedLists);
      setPreview(null);
      setUploadFile(null);
      const duplicates = selectedCount - added;
      setMessage(`${added} ${added === 1 ? 'word' : 'words'} added${duplicates ? `; ${duplicates} duplicate${duplicates === 1 ? '' : 's'} skipped` : ''}.`);
      return;
    }
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
      {pageMode && <div className="list-library-heading"><div><p className="eyebrow">YOUR VOCABULARY</p><h2>My word list</h2><p>{authenticated ? 'Search the dictionary and keep track of what you know.' : 'Your words are saved on this device.'}</p></div></div>}

      {busy && !lists.length && <p className="account-message">Loading your lists…</p>}
      {!busy && authenticated && !lists.length && !message && <p className="account-message">Your lists will appear here.</p>}
      {normalizedSearch && lists.length > 0 && visibleLists.length === 0 && <p className="account-message" role="status">No saved words match “{listSearch}”.</p>}
      {normalizedSearch.length >= 2 && <section className="dictionary-results" aria-label="Dictionary search results"><h3>Dictionary</h3>{dictionaryBusy && <p className="account-message">Searching…</p>}{!dictionaryBusy && dictionaryResults.length === 0 && <p className="account-message">No dictionary matches.</p>}{dictionaryResults.map(entry => {
        const list = lists[0];
        const alreadyAdded = list?.words.some(word => normalizeTerm(word.term) === normalizeTerm(entry.term)) ?? false;
        const definition = dictionaryDefinitions[entry.term];
        return <article className="dictionary-result" key={entry.term}><div><button className="dictionary-term" type="button" aria-expanded={definition !== undefined} onClick={() => void loadDictionaryDefinition(entry.term)} disabled={definitionBusyTerms.has(entry.term)}>{entry.term}</button>{definition !== undefined && <><span>{definition || 'Definition unavailable.'}</span>{entry.partOfSpeech.length > 0 && <small>{entry.partOfSpeech.join(', ')}</small>}</>}{definitionBusyTerms.has(entry.term) && <span role="status">Loading definition…</span>}</div><button className="bookmark-button" type="button" aria-label={alreadyAdded ? 'Already in word list' : `Save ${entry.term} to word list`} title={alreadyAdded ? 'Already in word list' : 'Save to word list'} disabled={alreadyAdded || !list || definition === undefined} onClick={() => list && definition !== undefined && addDictionaryWord(list.id, { ...entry, definition })}><BookmarkIcon added={alreadyAdded} />{alreadyAdded && <span>Added</span>}</button></article>;
      })}</section>}
      {visibleLists.map(list => {
        const listMatches = list.name.toLowerCase().includes(normalizedSearch);
        const visibleWords = normalizedSearch && !listMatches
          ? list.words.filter(word => `${word.term} ${word.definition}`.toLowerCase().includes(normalizedSearch))
          : list.words;
        const pageCount = Math.max(1, Math.ceil(visibleWords.length / 20));
        const currentPage = Math.min(wordPage, pageCount);
        const pageWords = visibleWords.slice((currentPage - 1) * 20, currentPage * 20);
        return <article className="word-list-card" key={list.id}>
        <div className="word-list-heading">
          <div className="word-list-select">
              <span><h3>{list.name}</h3></span>
            <span className="word-list-count">{list.words.length} words</span>
          </div>
        </div>

        <div className="word-list-detail">
          <section className="word-import" aria-label="Edit words">
            <div className="word-list-actions">
              <button className="account-action upload-toggle" type="button" aria-expanded={uploadOpen} disabled={busy} onClick={() => setUploadOpen(value => !value)}>Upload</button>
              <button className="account-action add-word-toggle" type="button" aria-expanded={addOpen} disabled={busy} onClick={() => setAddOpen(value => !value)}>Add</button>
            </div>
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

          {addOpen && <form className="word-add-form" onSubmit={event => { void submitWord(event, list.id); setAddOpen(false); }}>
            <h4>Add a word</h4>
            <label htmlFor={`word-term-${list.id}`}>Word</label>
            <input id={`word-term-${list.id}`} value={term} onChange={event => setTerm(event.target.value)} required maxLength={100} pattern="[A-Za-z][A-Za-z '-]{0,99}" />
            <label htmlFor={`word-definition-${list.id}`}>Definition</label>
            <input id={`word-definition-${list.id}`} value={definition} onChange={event => setDefinition(event.target.value)} maxLength={500} />
            <button className="account-action" type="submit">Add</button>
          </form>}
          <ul className="word-entry-list">
            {pageWords.map(word => <li key={word.id}>
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
          {visibleWords.length > 20 && <nav className="word-pagination" aria-label="Word list pages">
            <span>{(currentPage - 1) * 20 + 1}–{Math.min(currentPage * 20, visibleWords.length)} of {visibleWords.length} words</span>
            <div><button type="button" disabled={currentPage === 1} onClick={() => { setWordPage(currentPage - 1); setEditingWordId(''); }}>Previous</button>
              <span aria-live="polite">Page {currentPage} of {pageCount}</span>
              <button type="button" disabled={currentPage === pageCount} onClick={() => { setWordPage(currentPage + 1); setEditingWordId(''); }}>Next</button></div>
          </nav>}
          </section>
        </div>
      </article>;
      })}
      {message && <p className="account-message" role="status">{message}</p>}
    </div>
  </section>;
}
