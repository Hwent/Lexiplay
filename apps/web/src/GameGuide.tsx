import { useId } from 'react';
import { useTranslation } from './i18n';
import './game-guide.css';

function ExampleWord({ word, y, states = [], changed = -1 }: { word: string; y: number; states?: string[]; changed?: number }) {
  return <g>{[...word].map((letter, index) => <g key={index} className={`guide-letter ${states[index] ?? ''}`} transform={`translate(${14 + index * 48}, ${y})`}>
    <rect width="40" height="40" rx="7"/>
    <text x="20" y="26" textAnchor="middle">{letter}</text>
    {index === changed && <path className="guide-changed-letter" d="M9 34h22"/>}
  </g>)}</g>;
}

export default function GameGuide({ kind, wordLength, attempts }: { kind: 'word-puzzle' | 'word-ladder'; wordLength: number; attempts: number }) {
  const t = useTranslation(), descriptionId = useId();
  const ladder = kind === 'word-ladder';
  const chain = wordLength === 4 ? ['COLD', 'CORD', 'CARD', 'WARD', 'WARM'] : ['STONE', 'STORE', 'SHORE', 'SHARE', 'SPARE'];
  return <div className="game-guide">
    <svg className="game-guide-picture" viewBox="0 0 360 334" role="img" aria-label={t(ladder ? 'Word Ladder example' : 'Word puzzle example')} aria-describedby={descriptionId}>
      <desc id={descriptionId}>{t(ladder
        ? 'Start with {0}. Make four new words: {1}. Each word changes one letter from the previous word. Underlines show the changed letters.'
        : 'Five-letter example: the hidden word is PLANT. Guess SLATE: L and A are in the right spot, T belongs in another spot, and S and E are not in the word. Guess PLANT to win.', chain[0], chain.slice(1).join(', '))}</desc>
      <text className="guide-title" x="14" y="25">{t(ladder ? 'Change one letter' : 'Find the hidden word')}</text>
      <text className="guide-subtitle" x="14" y="49">{t(ladder ? '4 new words to win' : '5-letter example')}</text>
      {ladder ? chain.map((word, row) => <g key={word}>
        <ExampleWord word={word} y={64 + row * 52} changed={row ? [...word].findIndex((letter, index) => letter !== chain[row - 1]![index]) : -1}/>
        <text className="guide-row-label" x="264" y={89 + row * 52}>{t(row ? 'Word {0}' : 'Start', row)}</text>
        {row === 4 && <path className="guide-win-check" d="m336 286 6 6 10-12"/>}
      </g>) : <>
        <ExampleWord word="?????" y={64}/><text className="guide-row-label" x="264" y="89">{t('Hidden')}</text>
        <path className="guide-arrow" d="M130 115v20m-6-6 6 6 6-6"/>
        <ExampleWord word="SLATE" y={147} states={['absent', 'correct', 'correct', 'present', 'absent']}/><text className="guide-row-label" x="264" y="172">{t('Try a word')}</text>
        <path className="guide-arrow" d="M130 198v20m-6-6 6 6 6-6"/>
        <ExampleWord word="PLANT" y={230} states={Array<string>(5).fill('correct')}/><text className="guide-row-label" x="264" y="255">{t('Solved')}</text>
        {[['correct', 'Correct spot'], ['present', 'Wrong spot'], ['absent', 'Not in word']].map(([state, label], index) => <g key={state} className={`guide-key ${state}`} transform={`translate(${14 + index * 117}, 305)`}>
          <rect y="-11" width="12" height="12" rx="3"/><text x="19">{t(label!)}</text>
        </g>)}
      </>}
    </svg>
    <details className="game-rules" key={kind}>
      <summary><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/></svg><span>{t('How to play')}</span><svg className="guide-chevron" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary>
      {ladder ? <>
        <p>{t('Make four new words. Change exactly one letter from the previous word each time.')}</p>
        <p>{t('Use each word only once, including the starting word. Every new word comes with a definition.')}</p>
        <p>{t('Fill in the next word with a hint for 1 coin.')}</p>
      </> : <>
        <p>{t('Find the hidden {0}-letter word in {1} guesses. Each full word checks automatically.', wordLength, attempts)}</p>
        <p>{t('Green means the letter is in the correct spot. Yellow means it belongs in another spot. Gray means it is not in the word.')}</p>
        <p>{t('Letters can repeat. Each colored match counts once. Invalid words don’t use a guess.')}</p>
        <p>{t('A definition hint costs 1 coin.')}</p>
      </>}
      <p>{t('Only dictionary words are accepted. Invalid words do not count as attempts.')}</p>
      <p>{t('Choose a new puzzle before your first accepted word. After that, finish the game or give up. Giving up keeps the entry coin spent.')}</p>
    </details>
  </div>;
}
