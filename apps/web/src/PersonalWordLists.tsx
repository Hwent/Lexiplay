import { useTranslation } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { apiRequest as api } from './services/api-client';
import { PersonalList, PersonalPage, PersonalWord, VocabularyCollection } from './collection-types';
import PronunciationButton from './PronunciationButton';
import Icon from './Icon';
import usePendingWords from './usePendingWords';
import EmptyState from './EmptyState';

export default function PersonalWordLists({ signedIn, searchQuery, initialId, revision, onOpenCollection }: { signedIn: boolean; searchQuery: string; initialId: string; revision: number; onOpenCollection?: (slug:string)=>void }) {
  const t = useTranslation();
  const { store } = usePendingWords(initialId);
  const [list, setList] = useState<PersonalList | null>(null);
  const [data, setData] = useState<PersonalPage | null>(null);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState('');
  const [loadedKey, setLoadedKey] = useState('');
  const [listRetry, setListRetry] = useState(0);
  const [collections, setCollections] = useState<VocabularyCollection[]>([]);
  const query = searchQuery.trim();
  const requestKey = `${list?.id}|${page}|${query}|${refresh}|${revision}`;
  const currentKey = useRef(requestKey);
  useEffect(() => { currentKey.current = requestKey; }, [requestKey]);
  const showEntries = !!data && loadedKey === requestKey && !loading;

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

  useEffect(() => { setPage(1); }, [query]);
  useEffect(() => {
    if (!signedIn || !list) return;
    let active = true;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page: String(page), pageSize: '25', language: list.preferredLanguage, ...(query ? { q: query } : {}) });
    const path = `/word-lists/${list.id}/entries?${params}`;
    const cached = store.requests.peek<PersonalPage>(path);
    if (cached) { setData(cached); setLoadedKey(requestKey); setLoading(false); return; }
    store.requests.get<PersonalPage>(path).then(value => {
      if (active) { setData(value); setLoadedKey(requestKey); }
    }).catch(error => { if (active) setError(error instanceof Error ? error.message : 'Could not load your entries.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [signedIn, list, requestKey, store]);

  async function review(word: PersonalWord, again = false) {
    if (!list || writing.has(word.id)) return;
    const startedKey = requestKey;
    const update = { familiarity: again ? 0 : Math.min(5, word.familiarity + 1), nextReviewAt: new Date(again ? Date.now() : Date.now() + (word.familiarity >= 3 ? 7 : 1) * 86400000).toISOString() };
    setWriting(ids => new Set([...ids, word.id])); setError('');
    setData(value => value && ({ ...value, words: value.words.map(row => row.id === word.id ? { ...row, ...update } : row) }));
    try {
      await api(`/word-lists/${list.id}/entries/${word.id}`, { method: 'PATCH', body: JSON.stringify(update) });
      store.requests.invalidate(`/word-lists/${list.id}/entries`);
    } catch (error) {
      if (currentKey.current === startedKey) setData(value => value && ({ ...value, words: value.words.map(row => row.id === word.id ? word : row) }));
      setError(error instanceof Error ? error.message : 'Could not save your review.');
    } finally { setWriting(ids => { const next = new Set(ids); next.delete(word.id); return next; }); }
  }
  async function remove(word: PersonalWord) {
    if (!list || writing.has(word.id)) return;
    const startedKey = requestKey;
    const index = data?.words.findIndex(row => row.id === word.id) ?? 0;
    setWriting(ids => new Set([...ids, word.id])); setError('');
    setData(value => value && ({ ...value, total: value.total - 1, words: value.words.filter(row => row.id !== word.id) }));
    try {
      await api(`/word-lists/${list.id}/entries/${word.id}`, { method: 'DELETE' });
      store.removeSaved(word.lemma);
    } catch (error) {
      setData(value => {
        if (!value || currentKey.current !== startedKey) return value;
        const words = [...value.words]; words.splice(index, 0, word);
        return { ...value, total: value.total + 1, words };
      });
      setError(error instanceof Error ? error.message : 'Could not remove this word.');
    } finally { setWriting(ids => { const next = new Set(ids); next.delete(word.id); return next; }); }
  }

  async function unsave(collection: VocabularyCollection) {
    setBusy(true); setError('');
    const index = collections.findIndex(row => row.id === collection.id);
    setCollections(rows => rows.filter(row => row.id !== collection.id));
    try {
      await api(`/collections/${collection.slug}/save`, { method: 'DELETE' });
      store.requests.invalidate('/word-lists/collections');
    } catch (error) {
      setCollections(rows => { const next = [...rows]; next.splice(index, 0, collection); return next; });
      setError(error instanceof Error ? error.message : 'Could not remove this collection.');
    }
    finally { setBusy(false); }
  }

  function pagination(position: string) {
    return data && (data.total > data.pageSize || page > 1) && <nav className="word-pagination" aria-label={t('Personal list pages {0}', t(position))}><button type="button" disabled={page <= 1 || loading || busy || writing.size > 0} onClick={() => { setLoading(true); setPage(value => value - 1); }}>{t('Previous')}</button><span>{t('Page {0} of {1} · {2} {3}', page, Math.max(page, Math.ceil(data.total / data.pageSize)), data.total.toLocaleString(), (data.total === 1 ? t('word') : t('words')))}</span><button type="button" disabled={page * data.pageSize >= data.total || loading || busy || writing.size > 0} onClick={() => { setLoading(true); setPage(value => value + 1); }}>{t('Next')}</button></nav>;
  }
  if (!signedIn) return <EmptyState icon="library" title={t('My Word List')} action={<a className="primary-button" href="/account">{t('Sign in ')}<Icon name="arrow"/></a>}><p>{t('Sign in to save words and review your vocabulary.')}</p></EmptyState>;
  return <section className="personal-word-lists" aria-label={t('My Word List')} aria-busy={loading || busy || writing.size > 0}>
    {!!collections.length && <section aria-label={t('My collections')} className="saved-collections">
      <h2>{t('My collections')}</h2>
      <ul className="saved-collection-list">{collections.map(collection => <li key={collection.id}>
        <div className="saved-collection-heading"><span className="saved-collection-mark" aria-hidden="true">{collection.level ?? <Icon name="library"/>}</span><div><h3>{collection.name}</h3><span>{t('{0} words', collection.wordCount.toLocaleString())}</span></div></div>
        <div className="saved-collection-actions">{onOpenCollection && <button className="saved-collection-open" type="button" aria-label={t('Open {0}', collection.name)} disabled={busy} onClick={() => onOpenCollection(collection.slug)}>{t('Open collection ')}<Icon name="arrow"/></button>}
          <button className="saved-collection-remove" type="button" aria-label={t('Unsave {0}', collection.name)} disabled={busy} onClick={() => void unsave(collection)}>{t('Unsave')}</button></div>
      </li>)}</ul>
    </section>}
    <div className="library-section-heading"><h2>{t('Your words')}</h2>{data && data.total > 0 && <span className="library-count">{data.total.toLocaleString()} {query ? t('matching') : t('saved')} {data.total === 1 ? t('word') : t('words')}</span>}</div>
    {error && <p role="alert">{t(error)} <button type="button" onClick={() => { setLoading(true); if (list) { store.requests.invalidate(`/word-lists/${list.id}/entries`); setRefresh(value => value + 1); } else { store.requests.invalidate('/word-lists/mine'); setListRetry(value => value + 1); } }}>{t('Retry')}</button></p>}
    {pagination('top')}
    {showEntries && <>{data.words.length > 0 && <div className="library-table-scroll"><table className="library-data-table personal-entries-table" aria-label={t('Saved vocabulary')}><thead><tr><th scope="col">{t('Word')}</th><th scope="col">{t('Meaning')}</th><th scope="col">{t('Review')}</th></tr></thead><tbody>{data.words.map(word => <tr key={word.id}>
      <td><span className="word-with-pronunciation"><strong>{word.lemma}</strong><PronunciationButton term={word.lemma}/></span><small>{word.partOfSpeech}</small></td>
      <td><p className="personal-definition">{word.definition ?? t('Dictionary definition not available yet.')}</p></td>
      <td><div className="word-familiarity"><small>{t('Familiarity {0}/5', word.familiarity)}</small><span className="familiarity-dots" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <i key={index} data-filled={index < word.familiarity}/>)}</span></div>
      <div className="personal-entry-actions"><button type="button" disabled={writing.has(word.id)} onClick={() => void review(word)}>{t('Reviewed')}</button><button type="button" disabled={writing.has(word.id)} onClick={() => void review(word, true)}>{t('Review again')}</button><button type="button" disabled={writing.has(word.id)} onClick={() => void remove(word)}>{t('Remove {0}', word.lemma)}</button></div>
    </td></tr>)}</tbody></table></div>}{!data.words.length && <EmptyState icon="library" title={query ? t('No saved words match your search.') : t('Your word list is ready for a fresh start.')} action={<a className="primary-button" href="/dictionary">{t('Find words ')}<Icon name="arrow"/></a>}><p>{query ? t('Try a different word in the search above, or find something new in Dictionary.') : t('Save a word from Dictionary or explore a collection to build your list.')}</p></EmptyState>}</>}
    {showEntries && pagination('bottom')}
  </section>;
}
