import { useEffect, useState } from 'react';
import { apiRequest } from './services/api-client';
import { VocabularyCollection } from './collection-types';

export default function CollectionPicker({ value, disabled, onChange, onOpenLibrary }: {
  value: string; disabled: boolean; onChange: (id: string) => void; onOpenLibrary: () => void;
}) {
  const [collections, setCollections] = useState<VocabularyCollection[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    apiRequest<VocabularyCollection[]>('/collections').then(rows => {
      if (active && Array.isArray(rows)) setCollections(rows.filter(row => row.status === 'available'));
    }).catch(() => { if (active) setError('Collections could not be loaded.'); });
    return () => { active = false; };
  }, []);
  return <div className="cefr-pool-picker">
    <label htmlFor="game-collection">Official collection</label>
    <select id="game-collection" value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
      <option value="">Full dictionary</option>
      {collections.map(collection => <option value={collection.slug} key={collection.id}>{collection.name}</option>)}
    </select>
    <button type="button" className="text-action" onClick={onOpenLibrary}>Browse collections</button>
    {error && <p role="status">{error}</p>}
  </div>;
}
