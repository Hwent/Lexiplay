import { useTranslation } from './i18n';

export default function PuzzleGuessRow({ word, wordLength, label, states = [], labels = [], className = '', tileClassName = '', rejectedAttempt = 0, checking = false, revealing = false, onRevealEnd }: {
  word: string; wordLength: number; label: string; states?: readonly string[]; labels?: readonly string[];
  className?: string; tileClassName?: string; rejectedAttempt?: number; checking?: boolean; revealing?: boolean; onRevealEnd?: (() => void) | undefined;
}) {
  const t = useTranslation();
  return <div key={rejectedAttempt} className={`guess-row ${className}${rejectedAttempt ? ' invalid-guess' : ''}${revealing ? ' revealing-guess' : ''}${checking ? ' checking-guess' : ''}`}
    role="row" aria-label={label} aria-busy={checking || undefined} style={{ display: 'grid', gridTemplateColumns: `repeat(${wordLength}, minmax(0, 1fr))` }}
    onAnimationEnd={event => {
      if (event.animationName === 'puzzle-tile-reveal' && event.target === event.currentTarget.lastElementChild) onRevealEnd?.();
    }}>
    {Array.from({ length: wordLength }, (_, column) => {
      const letter = word[column] ?? '', state = states[column] ?? '';
      return <span role="gridcell" aria-label={labels[column] ?? (letter ? `${letter}, ${t(state || 'not submitted')}` : t('Empty'))}
        className={`letter-tile ${tileClassName} ${state} ${letter && !state ? 'filled' : ''}`}
        style={{ fontSize: `clamp(1rem, calc(64cqi / ${wordLength}), 2.25rem)` }} key={`${column}-${letter}`}>{letter}</span>;
    })}
  </div>;
}
