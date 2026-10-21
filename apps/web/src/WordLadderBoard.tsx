import { useTranslation } from './i18n';
import PuzzleGrid from './PuzzleGrid';
import PuzzleGuessRow from './PuzzleGuessRow';
import './word-ladder.css';

export type Ladder = { startWord: string; startDefinition?: string; targetWords: number };

export default function WordLadderBoard({ ladder, steps, guess, finished, busy, rejectedAttempt = 0, revealingRow, onRevealEnd }: {
  ladder: Ladder; steps: { guess: string }[]; guess: string; finished: boolean; busy: boolean;
  rejectedAttempt?: number; revealingRow?: number | undefined; onRevealEnd?: () => void;
}) {
  const t = useTranslation();
  const length = ladder.startWord.length;
  const neutral = Array<string>(length).fill('neutral');
  return <PuzzleGrid wordLength={length} label={t('Word ladder board')}>
    <PuzzleGuessRow word={ladder.startWord} wordLength={length} label={ladder.startWord} states={neutral} labels={[...ladder.startWord]}/>
    {Array.from({ length: Math.max(ladder.targetWords, steps.length) }, (_, row) => {
      const step = steps[row];
      const active = !finished && row === steps.length;
      return <PuzzleGuessRow key={row} className={step && row === ladder.targetWords - 1 ? 'ladder-solved' : ''}
        word={step?.guess ?? (active ? guess : '')} wordLength={length} label={step?.guess ?? t(active ? 'Next word' : 'Empty word')}
        states={step ? neutral : []} labels={step ? [...step.guess] : []}
        rejectedAttempt={active ? rejectedAttempt : 0} checking={active && busy}
        revealing={!!step && revealingRow === row} onRevealEnd={onRevealEnd}/>;
    })}
  </PuzzleGrid>;
}
