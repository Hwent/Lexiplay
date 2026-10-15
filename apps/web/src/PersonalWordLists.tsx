import { useEffect, useState } from 'react';
import { apiRequest as api } from './services/api-client';
import { PersonalList, PersonalPage, PersonalWord, VocabularyCollection } from './collection-types';
import PronunciationButton from './PronunciationButton';
import DictionaryTools from './DictionaryTools';
import Icon from './Icon';
import usePendingWords from './usePendingWords';

export default function PersonalWordLists({ signedIn, searchQuery, initialId, revision, onOpenCollection }: { signedIn: boolean; searchQuery: string; initialId: string; revision: number; onOpenCollection?: (slug:string)=>void }) {
  const { store } = usePendingWords(initialId);
  const [list, setList] = useState<PersonalList | null>(null);
  const [data, setData] = useState<PersonalPage | null>(null);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [tools, setTools] = useState(!!searchQuery);
  const [loadedKey, setLoadedKey] = useState('');
  const [listRetry, setListRetry] = useState(0);
  const [collections, setCollections] = useState<VocabularyCollection[]>([]);
  const query = searchQuery.trim();
  const requestKey = `${list?.id}|${page}|${query}|${refresh}|${revision}`;
  const showEntries = !!data && loadedKey === requestKey && !loading && !busy;

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    store.requests.get<VocabularyCollection[]>('/word-lists/collections').then(rows => {
      if (active && Array.isArray(rows)) setCollections(rows);
    }).catch(() => {});
    return () => { active = false; };
  }, [signedIn, revision, store]);

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    setLoading(true);
    setError('');
    store.requests.get<PersonalList[]>('/word-lists/mine').then(rows => {
      if (!active) return;
      if (!Array.isArray(rows)) throw new Error('Could not load your word list.');
      const chosen = rows.find(row => row.id === initialId) ?? rows.find(row => row.isDefault) ?? rows[0];
      if (!chosen) throw new Error('Could not find your word list.');
      setList(chosen);
    }).catch(error => { if (active) { setError(error instanceof Error ? error.message : 'Could not load your word list.'); setLoading(false); } });
    return () => { active = false; };
  }, [signedIn, initialId, revision, listRetry, store]);

  useEffect(() => { setPage(1); setMessage(''); if (query) setTools(true); }, [query]);
  useEffect(() => {
    if (!signedIn || !list) return;
    let active = true;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page: String(page), pageSize: '25', language: list.preferredLanguage, ...(query ? { q: query } : {}) });
    const path = `/word-lists/${list.id}/entries?${params}`;
    const cached = store.requests.peek<PersonalPage>(path);
    if (cached) { setData(cached); setLoadedKey(requestKey); setLoading(false); return; }
    const timer = setTimeout(() => {
      store.requests.get<PersonalPage>(path).then(value => {
        if (active) { setData(value); setLoadedKey(requestKey); }
      }).catch(error => { if (active) setError(error instanceof Error ? error.message : 'Could not load your entries.'); })
        .finally(() => { if (active) setLoading(false); });
    }, 150);
    return () => { active = false; clearTimeout(timer); };
  }, [signedIn, list, requestKey, store]);

  async function review(word: PersonalWord, again = false) {
    if (!list) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await api(`/word-lists/${list.id}/entries/${word.id}`, { method: 'PATCH', body: JSON.stringify({ familiarity: again ? 0 : Math.min(5, word.familiarity + 1), nextReviewAt: new Date(again ? Date.now() : Date.now() + (word.familiarity >= 3 ? 7 : 1) * 86400000).toISOString() }) });
      store.requests.invalidate(`/word-lists/${list.id}/entries`);
      setLoading(true); setRefresh(value => value + 1); setMessage('Your review was saved.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save your review.'); }
    finally { setBusy(false); }
  }
  async function remove(word: PersonalWord) {
    if (!list) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await api(`/word-lists/${list.id}/entries/${word.id}`, { method: 'DELETE' });
      store.invalidateWords();
      await store.loadSaved(true);
      if (page > 1 && data?.words.length === 1) setPage(value => value - 1);
      setLoading(true); setRefresh(value => value + 1);
      setMessage('Word removed. Saved collections will respect your choice.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not remove this word.'); }
    finally { setBusy(false); }
  }

  async function unsave(collection: VocabularyCollection) {
    setBusy(true); setError('');
    try {
      await api(`/collections/${collection.slug}/save`, { method: 'DELETE' });
      store.requests.invalidate('/word-lists/collections');
      setCollections(rows => rows.filter(row => row.id !== collection.id));
      setMessage('Collection removed. Your words and progress are kept.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not remove this collection.'); }
    finally { setBusy(false); }
  }

  function pagination(position: string) {
    return data && <nav className="word-pagination" aria-label={`Personal list pages ${position}`}><button type="button" disabled={page <= 1 || loading || busy} onClick={() => { setLoading(true); setMessage(''); setPage(value => value - 1); }}>Previous</button><span>Page {page} of {Math.max(1, Math.ceil(data.total / data.pageSize))} · {data.total.toLocaleString()} {data.total === 1 ? 'word' : 'words'}</span><button type="button" disabled={page * data.pageSize >= data.total || loading || busy} onClick={() => { setLoading(true); setMessage(''); setPage(value => value + 1); }}>Next</button></nav>;
  }
  if (!signedIn) return <><div className="library-empty"><h2>Your own dictionary collection</h2><p>Sign in to save dictionary words and review your vocabulary.</p><a href="/account">Sign in</a></div><DictionaryTools listId="" searchQuery={searchQuery}/></>;
  return <section className="personal-word-lists" aria-label="My Word List" aria-busy={loading || busy}>
    {!!collections.length && <section aria-label="My collections" className="saved-collections">
      <h2>My collections</h2>
      <div className="saved-collection-grid">{collections.map(collection => <article key={collection.id}>
        <div><strong>{collection.name}</strong><span>{collection.wordCount.toLocaleString()} words</span></div>
        <div>{onOpenCollection && <button type="button" disabled={busy} onClick={() => onOpenCollection(collection.slug)}>Open</button>}
          <button type="button" disabled={busy} onClick={() => void unsave(collection)}>Unsave {collection.name}</button></div>
      </article>)}</div>
    </section>}
    <div className="library-section-heading"><div><h2>Words worth keeping</h2><p className="collection-intro">Dictionary words, a little practice, your own pace.</p></div>{data && <span className="library-count">{data.total.toLocaleString()} {query ? 'matching' : 'saved'} {data.total === 1 ? 'word' : 'words'}</span>}</div>
    <div className="library-tools"><span><strong>Grow your vocabulary</strong><small>Find dictionary words or import a text list.</small></span><button type="button" className="text-action" aria-expanded={tools} aria-controls="library-dictionary-tools" onClick={() => setTools(value => !value)}><Icon name="search"/>{tools ? 'Close dictionary tools' : 'Open dictionary tools'}</button></div>
    {tools && list && <div id="library-dictionary-tools"><DictionaryTools listId={list.id} searchQuery={searchQuery}/></div>}
    {error && <p role="alert">{error} <button type="button" onClick={() => { setLoading(true); if (list) { store.requests.invalidate(`/word-lists/${list.id}/entries`); setRefresh(value => value + 1); } else { store.requests.invalidate('/word-lists/mine'); setListRetry(value => value + 1); } }}>Retry</button></p>}
    {message && <p role="status">{message}</p>}
    {pagination('top')}
    {(loading || busy) && <p className="library-loading" role="status">{busy ? 'Saving your review…' : 'Loading your entries…'}</p>}
    {showEntries && <><ul className="collection-word-rows personal-word-rows">{data.words.map(word => <li key={word.id}><div>
      <div className="personal-word-heading"><div><span className="word-with-pronunciation"><strong>{word.lemma}</strong><PronunciationButton term={word.lemma}/></span><small>{word.partOfSpeech}</small></div><div className="word-familiarity"><small>Familiarity {word.familiarity}/5</small><span className="familiarity-dots" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <i key={index} data-filled={index < word.familiarity}/>)}</span></div></div>
      <p className="personal-definition">{word.definition ?? 'Dictionary definition not available yet.'}</p>
      <div className="personal-entry-actions"><button type="button" onClick={() => void review(word)}>Reviewed</button><button type="button" onClick={() => void review(word, true)}>Review again</button><button type="button" onClick={() => void remove(word)}>Remove {word.lemma}</button></div>
    </div></li>)}</ul>{!data.words.length && <p className="library-empty">{query ? 'No saved words match your search. Try the dictionary tools above.' : 'Your word list is ready for a fresh start. Explore a collection or open dictionary tools to add words.'}</p>}</>}
    {showEntries && pagination('bottom')}
  </section>;
}
