import { useTranslation } from './i18n';
import { useEffect, useState } from 'react';
import { DictionaryEntry, normalizeTerm, searchDictionary } from './dictionary-cache';
import usePendingWords from './usePendingWords';
import PronunciationButton from './PronunciationButton';
import Icon from './Icon';
import { importTerms } from './dictionary-import';
import EmptyState from './EmptyState';


export default function DictionaryTools({ listId, searchQuery, signedIn = !!listId }: { listId: string; searchQuery: string; signedIn?: boolean }) {
  const t = useTranslation();
  const { store, selection } = usePendingWords(listId);
  const [mode, setMode] = useState<'search' | 'import'>('search');
  const [query, setQuery] = useState(searchQuery);
  const [results, setResults] = useState<DictionaryEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState('');
  const [pasted, setPasted] = useState('');
  const saving = selection.saving;
  const [reading, setReading] = useState(false);
  const saved = selection.saved;
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const normalized = normalizeTerm(query);
  const terms = importTerms(pasted);
  useEffect(() => {
    if (!listId) return;
    let active = true;
    void store.loadSaved().catch(error => { if (active) setError(error instanceof Error ? error.message : 'Could not load your saved words.'); });
    return () => { active = false; };
  }, [listId, store]);
  useEffect(() => { setQuery(searchQuery); setMode('search'); }, [searchQuery]);
  useEffect(() => {
    let active = true;
    setResults([]); setError(''); setSearching(normalized.length >= 2);
    if (normalized.length < 2 || mode !== 'search') { setSearching(false); return; }
    const timer = setTimeout(() => {
      searchDictionary(normalized).then(rows => { if (active) { setResults(rows); setSearched(normalized); } })
        .catch(error => { if (active) setError(error instanceof Error ? error.message : 'Could not search the dictionary.'); })
        .finally(() => { if (active) setSearching(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [normalized, mode, retry]);
  function stage(values: string[]) {
    if (!listId) return;
    setError(''); store.stage(values, listId);
  }
  async function readFile(file: File | undefined) {
    if (!file) return;
    setError('');
    const format = file.name.split('.').pop()?.toLowerCase();
    if (!['txt', 'csv', 'tsv'].includes(format ?? '')) { setError('Choose a TXT, CSV, or TSV word list.'); return; }
    if (file.size > 1_000_000) { setError('Choose a file smaller than 1 MB.'); return; }
    setReading(true);
    try { setPasted(importTerms(await file.text(), format as 'txt' | 'csv' | 'tsv').join('\n')); }
    catch { setError('Could not read this file. Try pasting the words instead.'); }
    finally { setReading(false); }
  }
  return <section className="dictionary-tools-panel" aria-label={t('Dictionary tools')} aria-busy={searching || saving || reading}>
    <div className="dictionary-tool-tabs" role="group" aria-label={t('Dictionary tool')}><button type="button" aria-pressed={mode === 'search'} onClick={() => { setMode('search'); }}><Icon name="search"/>{t('Find a word')}</button><button type="button" aria-pressed={mode === 'import'} onClick={() => { setMode('import'); }}>{t('Import words')}</button></div>
    {!signedIn && <p className="dictionary-tool-hint"><a href="/account">{t('Sign in')}</a>{t(' to save or import words.')}</p>}
    {mode === 'search' ? <>
      <label className="dictionary-search-label" htmlFor="library-dictionary-search">{t('Search the dictionary')}</label><input id="library-dictionary-search" type="search" value={query} maxLength={100} placeholder={t('Try a word, like curious')} onChange={event => { setQuery(event.target.value); }}/>
      {normalized.length < 2 && <EmptyState icon="dictionary" title={t('A word worth discovering.')} action={<button className="primary-button" type="button" onClick={() => setQuery('curious')}>{t('Try “curious” ')}<Icon name="arrow"/></button>}></EmptyState>}
      {searching && <p role="status">{t('Searching the dictionary…')}</p>}
      {!searching && normalized.length >= 2 && searched === normalized && !results.length && !error && <EmptyState icon="search" title={t('No dictionary matches.')} action={<button className="primary-button" type="button" onClick={() => setQuery('curious')}>{t('Try “curious” ')}<Icon name="arrow"/></button>}><p>{t('Try another spelling or discover a word to get started.')}</p></EmptyState>}
      {!searching && searched === normalized && <ul className="dictionary-tool-results">{results.map(entry => {
        const definition = entry.definition || entry.senses?.flatMap(sense => sense.definitions).join('; ');
        const pending = selection.pending.has(entry.term.trim());
        return <li key={entry.term}><div><span className="word-with-pronunciation"><strong>{entry.term}</strong><PronunciationButton term={entry.term}/></span><small>{entry.partOfSpeech.join(' · ')}</small><p>{definition || t('Dictionary definition not available.')}</p></div><button type="button" disabled={!listId || saving || saved.has(entry.term) || !definition} aria-pressed={pending} aria-label={saved.has(entry.term) ? t('Saved {0}', entry.term) : pending ? t('Cancel addition of {0}', entry.term) : t('Add {0}', entry.term)} onClick={() => { store.toggle(entry.term, '', listId); }}><Icon name={saved.has(entry.term) || pending ? 'check' : 'plus'}/>{saved.has(entry.term) ? t('Saved') : pending ? t('Cancel addition') : t('Add word')}</button></li>;
      })}</ul>}
    </> : <>
      <label className="dictionary-search-label" htmlFor="library-import-words">{t('Words to import')}</label><textarea id="library-import-words" rows={5} value={pasted} maxLength={25000} placeholder={'curious\nexplore\nconfidence'} disabled={saving || reading} onChange={event => { setPasted(event.target.value); }}/>
      <p className="dictionary-tool-hint">{t('One word or phrase per line, up to 200. For CSV or TSV files, use the first column for words. Duplicates and words without definitions are skipped.')}</p>
      <div className="dictionary-import-actions"><label className="dictionary-file-label">{t('Choose a word file')}<input aria-label={t('Choose a word file')} type="file" accept=".txt,.csv,.tsv" disabled={saving || reading} onChange={event => { void readFile(event.target.files?.[0]); event.target.value = ''; }}/></label><span>{t('{0} unique {1}', terms.length, (terms.length === 1 ? t('word') : t('words')))}</span><button type="button" disabled={!listId || saving || reading || !terms.length || terms.length > 200 || terms.some(term => term.length > 100)} onClick={() => stage(terms)}>{t('Select dictionary matches')}</button></div>
      {terms.length > 200 && <p role="alert">{t('Import up to 200 unique words at a time.')}</p>}
      {terms.some(term => term.length > 100) && <p role="alert">{t('Each word or phrase must be 100 characters or fewer.')}</p>}
    </>}
    {mode === 'import' && selection.pending.size > 0 && <button type="button" className="quiet-button" disabled={saving} onClick={() => store.cancelAll()}>{t('Cancel additions')}</button>}
    {error && <p role="alert">{t(error)} {mode === 'search' && normalized.length >= 2 && <button type="button" onClick={() => setRetry(value => value + 1)}>{t('Retry search')}</button>}</p>}
  </section>;
}
