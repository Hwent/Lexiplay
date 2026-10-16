import { useEffect, useState } from 'react';
import { ApiError } from './services/api-client';
import usePendingWords from './usePendingWords';
type GameOptions = { wordLength: number; totalWords: number; collections: { id: string; slug: string; name: string; wordCount: number }[] };

export default function CollectionPicker({ value, wordLength, disabled, personalAvailable = false, onChange }: {
  value: string; wordLength: number; disabled: boolean; personalAvailable?: boolean; onChange: (id: string) => void;
}) {
  const { store } = usePendingWords();
  const [options, setOptions] = useState<GameOptions | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    const path = `/collections/game-options?wordLength=${wordLength}`;
    const cached = store.requests.peek<GameOptions>(path);
    if (cached) { setOptions(cached); return; }
    const timer = window.setTimeout(() => {
      store.requests.get<GameOptions>(path, 300_000).then(result => {
        if (result.wordLength !== wordLength || !Array.isArray(result.collections)) {
          store.requests.invalidate(path);
          throw new Error('Invalid collection response');
        }
        if (active) setOptions(result);
      }).catch(error => {
        if (active) setError(error instanceof ApiError && error.status === 429
          ? 'Word counts are busy. Try again shortly.' : 'Word counts are unavailable. You can still choose a collection.');
      });
    }, 150);
    return () => { active = false; window.clearTimeout(timer); };
  }, [wordLength, retry, store]);
  const ready = options?.wordLength === wordLength;
  const count = ready ? value ? options.collections.find(collection => collection.slug === value || collection.id === value)?.wordCount : options.totalWords : undefined;
  return <div className="game-collection-picker">
    <label htmlFor="game-collection">Collection</label>
    <select id="game-collection" value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
      <option value="">{wordLength === 5 ? 'Classic Wordle' : 'Common vocabulary'}</option>
      <option value="my-words" disabled={!personalAvailable}>My word list{personalAvailable ? '' : ' · Sign in'}</option>
      {options?.collections.map(collection => <option value={collection.slug} key={collection.id} disabled={ready && collection.wordCount === 0}>{collection.name}{ready ? ` · ${collection.wordCount.toLocaleString()} words` : ''}</option>)}
    </select>
    {!disabled && count !== undefined && <p className="game-collection-count" aria-label="Playable words"><strong>{count.toLocaleString()}</strong> {count === 1 ? 'word' : 'words'}</p>}
    {!ready && !error && <p className="game-collection-count">Loading collections…</p>}
    {error && <div className="collection-count-error"><p role="status">{error}</p><button type="button" className="quiet-button" disabled={disabled} onClick={() => setRetry(value => value + 1)}>Retry counts</button></div>}
  </div>;
}
