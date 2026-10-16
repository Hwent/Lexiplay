import { useEffect, useState } from 'react';
import { apiRequest } from './services/api-client';
type GameOptions = { wordLength: number; totalWords: number; collections: { id: string; slug: string; name: string; wordCount: number }[] };

export default function CollectionPicker({ value, wordLength, disabled, personalAvailable = false, onChange }: {
  value: string; wordLength: number; disabled: boolean; personalAvailable?: boolean; onChange: (id: string) => void;
}) {
  const [options, setOptions] = useState<GameOptions | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setError('');
    apiRequest<GameOptions>(`/collections/game-options?wordLength=${wordLength}`).then(result => {
      if (!Array.isArray(result.collections)) throw new Error('Invalid collection response');
      if (active) setOptions(result);
    }).catch(() => { if (active) setError('Collections could not be loaded.'); });
    return () => { active = false; };
  }, [wordLength]);
  const ready = options?.wordLength === wordLength;
  const count = ready ? value ? options.collections.find(collection => collection.slug === value || collection.id === value)?.wordCount : options.totalWords : undefined;
  return <div className="game-collection-picker">
    <label htmlFor="game-collection">Collection</label>
    <select id="game-collection" value={value} disabled={disabled || !ready} onChange={event => onChange(event.target.value)}>
      <option value="">{wordLength === 5 ? 'Classic Wordle' : 'Common vocabulary'}</option>
      <option value="my-words" disabled={!personalAvailable}>My word list{personalAvailable ? '' : ' · Sign in'}</option>
      {options?.collections.map(collection => <option value={collection.slug} key={collection.id} disabled={ready && collection.wordCount === 0}>{collection.name}{ready ? ` · ${collection.wordCount.toLocaleString()} words` : ''}</option>)}
    </select>
    {!disabled && count !== undefined && <p className="game-collection-count" aria-label="Playable words"><strong>{count.toLocaleString()}</strong> {count === 1 ? 'word' : 'words'}</p>}
    {!ready && !error && <p className="game-collection-count">Loading collections…</p>}
    {error && <p role="status">{error}</p>}
  </div>;
}
