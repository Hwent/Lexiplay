import { useEffect, useState, type ReactNode } from 'react';
import { dictionaryDefinition } from '../dictionary-cache';
import { useTranslation } from '../i18n';
import PronunciationButton from '../PronunciationButton';

export default function AnimalDictionaryAnswer({ term, bookmark }: { term: string; bookmark: (term: string, definition: string) => ReactNode }) {
  const t = useTranslation();
  const [definition, setDefinition] = useState('');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setFailed(false); setDefinition('');
    dictionaryDefinition(term)
      .then(result => { if (active) setDefinition(result); })
      .catch(() => { if (active) setFailed(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [term, attempt]);

  if (loading) return <p className="animal-dictionary-status" role="status">{t('Searching the dictionary…')}</p>;
  if (failed) return <div className="animal-dictionary-status"><p role="status">{t('Could not look up this word. Your answer is still saved in this round.')}</p><button type="button" className="quiet-button" onClick={() => setAttempt(value => value + 1)}>{t('Retry search')}</button></div>;
  if (!definition.trim()) return null;
  return <div className="answer-definition animal-learning-card">
    <div><p className="eyebrow">{t('YOUR ANIMAL')}</p><div className="word-with-pronunciation"><strong lang="en">{term}</strong><PronunciationButton term={term}/></div><p lang="en">{definition}</p></div>
    {bookmark(term, definition)}
  </div>;
}
