import { useEffect, useState } from 'react';
import { apiRequest } from './services/api-client';

export type VocabularyRangeOption = { id: string; label: string; description: string; wordCounts: Record<string, number> };

export default function useVocabularyRanges(enabled: boolean) {
  const [ranges, setRanges] = useState<VocabularyRangeOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!enabled || ranges !== null) return;
    let active = true;
    setLoading(true);
    setError('');
    apiRequest<VocabularyRangeOption[]>('/games/vocabulary-ranges').then(result => {
      if (!Array.isArray(result)) throw new Error('Vocabulary ranges are unavailable.');
      if (active) { setRanges(result); setLoading(false); }
    }).catch(() => {
      if (active) { setError('Could not load vocabulary ranges.'); setLoading(false); }
    });
    return () => { active = false; };
  }, [enabled, revision, ranges]);

  return { ranges, loading, error, retry: () => { setRanges(null); setRevision(value => value + 1); } };
}
