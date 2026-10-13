import { useEffect, useRef, useState } from 'react';

let activeUtterance: SpeechSynthesisUtterance | null = null;

export default function PronunciationButton({ term }: { term: string }) {
  const supported = typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance === 'function';
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState('');
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    setSpeaking(false);
    setError('');
    return () => {
      const utterance = utteranceRef.current;
      if (!utterance) return;
      utterance.onend = null;
      utterance.onerror = null;
      if (activeUtterance === utterance) {
        activeUtterance = null;
        window.speechSynthesis.cancel();
      }
      utteranceRef.current = null;
    };
  }, [term]);

  function pronounce() {
    if (!supported) return;
    setError('');
    if (speaking && activeUtterance === utteranceRef.current) {
      window.speechSynthesis.cancel();
      activeUtterance = null;
      utteranceRef.current = null;
      setSpeaking(false);
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(term);
      utterance.lang = 'en-US';
      utterance.rate = .85;
      const voices = window.speechSynthesis.getVoices();
      const voice = voices.find(item => item.localService && /^en(?:-|$)/i.test(item.lang))
        ?? voices.find(item => /^en(?:-|$)/i.test(item.lang));
      if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
      const finish = () => {
        if (utteranceRef.current === utterance) { utteranceRef.current = null; setSpeaking(false); }
        if (activeUtterance === utterance) activeUtterance = null;
      };
      utterance.onend = finish;
      utterance.onerror = event => {
        if (utteranceRef.current === utterance && !['canceled', 'interrupted'].includes(event.error)) {
          setError('Could not play pronunciation. Try again.');
        }
        finish();
      };
      utteranceRef.current = utterance;
      activeUtterance = utterance;
      setSpeaking(true);
      window.speechSynthesis.speak(utterance);
    } catch {
      setSpeaking(false);
      utteranceRef.current = null;
      activeUtterance = null;
      setError('Could not play pronunciation. Try again.');
    }
  }

  return <span className="pronunciation-control">
    <button type="button" className="pronunciation-button" aria-label={`${speaking ? 'Stop pronouncing' : 'Pronounce'} ${term}`} aria-pressed={speaking} title={supported ? `Hear ${term} pronounced` : 'Pronunciation is unavailable in this browser'} disabled={!supported} onClick={pronounce}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9h4l5-4v14l-5-4H4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
    </button>
    {error && <small className="pronunciation-error" role="status">{error}</small>}
  </span>;
}
