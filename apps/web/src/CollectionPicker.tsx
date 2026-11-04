import { useTranslation } from './i18n';
import { useEffect, useState } from 'react';
import { ApiError } from './services/api-client';
import usePendingWords from './usePendingWords';
import { GameOptions, GAME_OPTIONS_PATH, GAME_OPTIONS_LIFETIME } from './services/game-options';

export default function CollectionPicker({ value, wordLength, disabled, onChange }: {
  value: string; wordLength: number; disabled: boolean; onChange: (id: string) => void;
}) {
  const t = useTranslation();
  const { store } = usePendingWords();
  const [loadedOptions, setLoadedOptions] = useState<GameOptions[]>([]);
  const options = (store.requests.peek<GameOptions[]>(GAME_OPTIONS_PATH) ?? loadedOptions)
    .find(option => option.wordLength === wordLength);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    const cached = store.requests.peek<GameOptions[]>(GAME_OPTIONS_PATH)?.find(option => option.wordLength === wordLength);
    if (cached) return;
    store.requests.get<GameOptions[]>(GAME_OPTIONS_PATH, GAME_OPTIONS_LIFETIME).then(rows => {
      const result = rows.find(option => option.wordLength === wordLength);
      if (!result || !Array.isArray(result.collections)) {
        store.requests.invalidate(GAME_OPTIONS_PATH);
        throw new Error('Invalid collection response');
      }
      if (active) setLoadedOptions(rows);
    }).catch(error => {
      if (active) setError(error instanceof ApiError && error.status === 429
        ? 'Word counts are busy. Try again shortly.' : 'Word counts are unavailable. You can still choose a collection.');
    });
    return () => { active = false; };
  }, [wordLength, retry, store]);
  const ready = options?.wordLength === wordLength;
  const selectedCollection = options?.collections.find(collection => collection.slug === value || collection.id === value);
  const count = ready ? value ? selectedCollection?.wordCount : options.totalWords : undefined;
  return <div className="game-collection-picker" aria-busy={!ready && !error}>
    <label htmlFor="game-collection">{t('Collection')}</label>
    <select id="game-collection" value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
      <option value="">{wordLength === 5 ? t('Classic Wordle') : t('Common vocabulary')}</option>
      {value && !selectedCollection && <option value={value}>{t('Selected collection')}</option>}
      {options?.collections.map(collection => <option value={collection.slug} key={collection.id} disabled={ready && collection.wordCount === 0}>{collection.name}{ready ? t(' · {0} words', collection.wordCount.toLocaleString()) : ''}</option>)}
    </select>
    {!disabled && <p className="game-collection-count" aria-label={count === undefined ? undefined : t('Playable words')} aria-hidden={count === undefined}>{count !== undefined && <><strong>{count.toLocaleString()}</strong> {count === 1 ? t('word') : t('words')}</>}</p>}
    {error && <div className="collection-count-error"><p role="status">{t(error)}</p><button type="button" className="quiet-button" disabled={disabled} onClick={() => setRetry(value => value + 1)}>{t('Retry counts')}</button></div>}
  </div>;
}
