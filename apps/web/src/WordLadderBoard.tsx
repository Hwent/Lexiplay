import { type CSSProperties, useEffect, useRef } from 'react';
import { useTranslation } from './i18n';
import PronunciationButton from './PronunciationButton';
import './word-ladder.css';

export type Ladder = { startWord: string; startDefinition?: string; goalWord: string; goalDefinition?: string; shortestSteps: number };

export default function WordLadderBoard({ ladder, steps, guess, finished, busy, rejected }: {
  ladder: Ladder; steps: { guess: string }[]; guess: string; finished: boolean; busy: boolean; rejected: boolean;
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
      {words.map((word, row) => <div className="ladder-rung" key={row}>
        <div className="ladder-tiles" role="row" aria-label={word}>
          {[...word].map((letter, column) => {
            const changed = row > 0 && letter !== words[row - 1]![column];
            const correct = letter === ladder.goalWord[column];
            return <span role="gridcell" aria-label={changed ? `${t('{0}, changed letter', letter)}, ${t(correct ? 'Matches goal' : 'Does not match goal')}` : letter} className={`ladder-tile${changed ? ` changed ${correct ? 'correct' : 'present'}` : ''}`} key={column}>{letter}</span>;
          })}
        </div>
      </div>)}
      {!finished && <div className={`ladder-rung${rejected ? ' invalid-guess' : ''}`}>
        <div className="ladder-tiles" role="row" aria-label={t('Next word')} aria-busy={busy}>
          {Array.from({ length }, (_, column) => <span role="gridcell" className={`ladder-tile next${guess[column] ? ' filled' : ''}`} key={column}>{guess[column] ?? ''}</span>)}
        </div>
      </div>}
    </div>
  </div>;
}
