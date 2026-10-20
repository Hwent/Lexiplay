import { type CSSProperties, useEffect, useRef } from 'react';
import { useTranslation } from './i18n';
import PronunciationButton from './PronunciationButton';
import PuzzleGuessRow from './PuzzleGuessRow';
import './word-ladder.css';

export type Ladder = { startWord: string; startDefinition?: string; goalWord: string; goalDefinition?: string; shortestSteps: number };

export default function WordLadderBoard({ ladder, steps, guess, finished, busy, rejectedAttempt = 0, revealingRow, onRevealEnd }: {
  ladder: Ladder; steps: { guess: string }[]; guess: string; finished: boolean; busy: boolean;
  rejectedAttempt?: number; revealingRow?: number | undefined; onRevealEnd?: () => void;
}) {
  const t = useTranslation();
  const words = [ladder.startWord, ...steps.map(step => step.guess)];
  const length = ladder.startWord.length;
  const pathRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pathRef.current) pathRef.current.scrollTop = pathRef.current.scrollHeight;
  }, [steps.length]);
  return <div className="ladder-stage" style={{ '--ladder-length': length } as CSSProperties}>
    <div className="ladder-goal">
      <div className="ladder-tiles" aria-label={t('Goal: {0}', ladder.goalWord)}>{[...ladder.goalWord].map((letter, index) => <span className="ladder-tile correct" key={index}>{letter}</span>)}</div>
      <details className="ladder-goal-details"><summary>{t('Learn more')}</summary>
        <div className="ladder-goal-definition"><div>{ladder.goalDefinition || t('Definition unavailable.')}</div><PronunciationButton term={ladder.goalWord}/></div>
      </details>
    </div>
    <div ref={pathRef} className="ladder-path" role="grid" aria-label={t('Word ladder board')}>
      {words.map((word, row) => {
        const states = [...word].map((letter, column) => letter === ladder.goalWord[column] ? 'correct' : row > 0 && letter !== words[row - 1]![column] ? 'present' : 'neutral');
        const labels = [...word].map((letter, column) => {
          const changed = row > 0 && letter !== words[row - 1]![column];
          if (states[column] === 'neutral') return letter;
          return `${changed ? t('{0}, changed letter', letter) : letter}, ${t(states[column] === 'correct' ? 'Matches goal' : 'Does not match goal')}`;
        });
        return <PuzzleGuessRow key={row} className={`ladder-tiles${word === ladder.goalWord ? ' ladder-solved' : ''}`} tileClassName="ladder-tile" word={word} wordLength={length} label={word} states={states} labels={labels} revealing={row > 0 && revealingRow === row - 1} onRevealEnd={onRevealEnd}/>;
      })}
      {!finished && <PuzzleGuessRow className="ladder-tiles" tileClassName="ladder-tile next" word={guess} wordLength={length} label={t('Next word')} rejectedAttempt={rejectedAttempt} checking={busy}/>}
    </div>
  </div>;
}
