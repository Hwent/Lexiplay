import { useEffect, useState } from 'react';
import DictionaryTools from './DictionaryTools';
import Icon from './Icon';
import usePendingWords from './usePendingWords';
import { PersonalList } from './collection-types';
import './library.css';
import './dictionary.css';

export default function DictionaryPage({ signedIn, accountLoading, searchQuery = '' }: { signedIn: boolean; accountLoading: boolean; searchQuery?: string }) {
  const { store } = usePendingWords();
  const [listId, setListId] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setListId('');
    setError('');
    if (!signedIn) return;
    let active = true;
    store.requests.get<PersonalList[]>('/word-lists/mine').then(lists => {
      const list = lists.find(item => item.isDefault) ?? lists[0];
      if (!list) throw new Error('Your word list is unavailable.');
      if (active) setListId(list.id);
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load your word list.'); });
    return () => { active = false; };
  }, [signedIn, store, retry]);

  return <section className="dictionary-page" aria-label="Dictionary">
    <div className="page-introduction"><div><h2>Find your <span>next word.</span></h2></div><span className="page-intro-icon" aria-hidden="true"><Icon name="dictionary" /></span></div>
    {accountLoading ? <p role="status">Loading dictionary…</p> : <DictionaryTools listId={signedIn ? listId : ''} signedIn={signedIn} searchQuery={searchQuery} />}
    {signedIn && !listId && !error && !accountLoading && <p role="status">Loading your word list…</p>}
    {error && <p role="alert">{error} <button className="quiet-button" type="button" onClick={() => { store.requests.invalidate('/word-lists/mine'); setRetry(value => value + 1); }}>Retry word list</button></p>}
  </section>;
}
