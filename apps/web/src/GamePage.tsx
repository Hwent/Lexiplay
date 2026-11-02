import type { RefObject, KeyboardEvent, ReactNode } from 'react';
import type { Game, Feedback, HintType } from './game-types';
import { sectionPaths, type Section } from './routes';
import { useTranslation } from './i18n';
import Icon from './Icon';
import CollectionPicker from './CollectionPicker';
import PuzzleCelebration from './PuzzleCelebration';
import WordLadderBoard from './WordLadderBoard';
import GameGuide from './GameGuide';
import PuzzleGuessRow from './PuzzleGuessRow';
import PuzzleGrid from './PuzzleGrid';
import PronunciationButton from './PronunciationButton';
import DefinitionText from './DefinitionText';
const keyboardRows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const lengthName = (length: number) => `${['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][length]}-letter`;

type Props = {
  game: Game | null;
  busy: boolean;
  progressSaving: boolean;
  restoring: boolean;
  puzzleKind: 'word-puzzle' | 'word-ladder';
  ladderWordLength: number;
  selectedWordLength: number;
  selectedPoolId: string;
  firstGuestVisit: RefObject<boolean>;
  setupReward: number;
  accountLoading: boolean;
  walletOwner: string | null;
  account: { id: string } | null;
  puzzleRef: RefObject<HTMLDivElement | null>;
  celebrationId: string;
  finished: boolean | undefined;
  attemptsRemaining: number;
  message: string;
  rejectedAttempt: number;
  gameInputFocused: boolean;
  submittingGuess: RefObject<boolean>;
  guess: string;
  revealingGuess: { gameId: string; row: number } | null;
  playAgainRef: RefObject<HTMLButtonElement | null>;
  accountError: string;
  inputRef: RefObject<HTMLInputElement | null>;
  keyboardFeedback: Map<string, Feedback>;
  focusGameInput: () => void;
  setLadderWordLength: (value: number) => void;
  setSelectedWordLength: (value: number) => void;
  setSelectedPoolId: (value: string) => void;
  startPractice: (again?: boolean) => Promise<void>;
  exitGame: () => Promise<void>;
  giveUp: () => Promise<void>;
  setRevealingGuess: (value: { gameId: string; row: number } | null) => void;
  navigateTo: (section: Section) => void;
  setGameInputFocused: (value: boolean) => void;
  changeGuess: (value: string) => void;
  handleInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  hintPanel: (type: HintType) => ReactNode;
  submitGuess: (guess?: string) => Promise<void>;
  addLetter: (letter: string) => void;
  deleteLetter: () => void;
  wordBookmark: (term: string, definition: string) => ReactNode;
};

export default function GamePage({
  game,
  busy,
  progressSaving,
  restoring,
  puzzleKind,
  ladderWordLength,
  selectedWordLength,
  selectedPoolId,
  firstGuestVisit,
  setupReward,
  accountLoading,
  walletOwner,
  account,
  puzzleRef,
  celebrationId,
  finished,
  attemptsRemaining,
  message,
  rejectedAttempt,
  gameInputFocused,
  submittingGuess,
  guess,
  revealingGuess,
  playAgainRef,
  accountError,
  inputRef,
  keyboardFeedback,
  focusGameInput,
  setLadderWordLength,
  setSelectedWordLength,
  setSelectedPoolId,
  startPractice,
  exitGame,
  giveUp,
  setRevealingGuess,
  navigateTo,
  setGameInputFocused,
  changeGuess,
  handleInputKeyDown,
  hintPanel,
  submitGuess,
  addLetter,
  deleteLetter,
  wordBookmark,
}: Props) {
  const t = useTranslation();
  return (
    <>
      <section className="game-card" aria-label={t('Vocabulary puzzle')} aria-busy={busy || progressSaving || restoring} onClick={event => {
        const target = event.target;
        if (target instanceof Element && target.closest('button, input, a, select, textarea')) return;
        focusGameInput();
      }}>
        {!game ? (
          <div className="welcome-card">
            <div className="practice-story">
            <h2>{t(puzzleKind === 'word-ladder' ? 'Word Ladder' : 'Word puzzle')}</h2>
            <GameGuide kind={puzzleKind} wordLength={puzzleKind === 'word-ladder' ? ladderWordLength : selectedWordLength} attempts={6}/>
            </div>
            <div className="practice-setup">
            <div className="practice-setup-heading"><h3>{t('Puzzle options')}</h3></div>
            <div className="practice-options">
              <fieldset className="length-options"><legend>{t('Word length')}</legend>
                <div className={`length-segments${puzzleKind === 'word-ladder' ? ' ladder-length-options' : ''}`}>
                  {(puzzleKind === 'word-ladder' ? [4, 5] : [3, 4, 5, 6, 7, 8, 9]).map(length => <label key={length} className={(puzzleKind === 'word-ladder' ? ladderWordLength : selectedWordLength) === length ? 'selected' : ''}>
                    <input type="radio" name="word-length" value={length} checked={(puzzleKind === 'word-ladder' ? ladderWordLength : selectedWordLength) === length} onChange={() => puzzleKind === 'word-ladder' ? setLadderWordLength(length) : setSelectedWordLength(length)} aria-label={t('{0} letters', length)} />
                    <span>{length}</span>
                  </label>)}
                </div>
              </fieldset>
              {puzzleKind === 'word-puzzle' && <>
              <CollectionPicker value={selectedPoolId} wordLength={selectedWordLength} disabled={busy} onChange={id => {
                firstGuestVisit.current = false;
                setSelectedPoolId(id);
              }} />
              </>}
            </div>
            <div className="game-price" aria-label={t('Entry: 1 coin. Win: {0} coins', setupReward)}><span><Icon name="coin"/>{t('1 to play')}</span><span><Icon name="coin"/>+{setupReward}{t(' on a win')}</span></div>
            <button className="primary-button" onClick={() => void startPractice()} disabled={busy || progressSaving || restoring || accountLoading || walletOwner !== (account?.id ?? 'guest')}>{t(puzzleKind === 'word-ladder' ? 'Start ladder ' : 'Start practice ')}<Icon name="arrow"/>
            </button>
            </div>
          </div>
        ) : (
          <div ref={puzzleRef} key={game.id} className={`puzzle${game.ladder ? ' ladder-puzzle' : ''}${celebrationId === game.id ? ' puzzle-won' : ''}`}>
            {celebrationId === game.id && <PuzzleCelebration key={game.id}/>}
            <div className="puzzle-heading">
              <div><p className="eyebrow">{t('{0} · {1} letters', t(game.ladder ? 'Word Ladder' : 'Word puzzle'), game.wordLength)}</p>{game.pool && <small>{t(game.pool.name)} · {game.pool.author}</small>}</div>
              <span className="attempt-counter" aria-live="polite">{game.ladder ? t('{0} / {1} words', game.guesses.length, game.ladder.targetWords) : t('{0} {1} left', attemptsRemaining, (attemptsRemaining === 1 ? t('guess') : t('guesses')))}</span>
            </div>
            {!finished && <div className="puzzle-tools"><button className="account-link" type="button" onClick={exitGame} disabled={busy || progressSaving || game.guesses.length > 0} title={t('Available before your first accepted word')}>{t('Choose a new puzzle')}</button><button className="account-link" type="button" onClick={() => void giveUp()} disabled={busy || progressSaving}>{t('Give up')}</button></div>}
            <p className={`puzzle-message${rejectedAttempt ? ' invalid' : ''}`} role="status" aria-live="polite">{
              game.cancellationReason ? t(game.cancellationReason) + t(' Your entry cost was returned to the original wallet.')
              : message ? t(message)
              : finished ? game.ladder
                ? game.status === 'won' ? t('{0} new words made.', game.guesses.length) : t('Challenge ended.')
                : t('{0} in {1} guesses.', t(game.status === 'won' ? 'Solved' : 'Puzzle complete'), game.attemptCount ?? game.guesses.length)
              : !gameInputFocused ? t('Click anywhere in the puzzle to resume typing.')
              : game.ladder ? t('Change one letter. Complete words check automatically.')
              : t('Type {0} letters to check your word automatically.', game.wordLength)
            }</p>
            {!finished && (game.revealedPresent.length > 0 || game.revealedAbsent.length > 0) && <div className="puzzle-revealed-hints" aria-label={t('Revealed letters')}>
              {game.revealedPresent.length > 0 && <span>{t('In the word: ')}<strong>{game.revealedPresent.map(letter => letter.toUpperCase()).join(' · ')}</strong>{t(' · position unknown')}</span>}
              {game.revealedAbsent.length > 0 && <span>{t('Ruled out: ')}<strong>{game.revealedAbsent.map(letter => letter.toUpperCase()).join(' · ')}</strong></span>}
            </div>}
            <div className="puzzle-columns">
            <div className={`puzzle-stage${!finished ? ' with-hints' : ''}`}>
            <div className="puzzle-play-column">
            {game.ladder ? <WordLadderBoard ladder={game.ladder} steps={game.guesses} guess={guess} finished={!!finished} busy={busy && submittingGuess.current} rejectedAttempt={rejectedAttempt} revealingRow={revealingGuess?.gameId === game.id ? revealingGuess.row : undefined} onRevealEnd={() => setRevealingGuess(null)}/> : (!finished || game.guesses.length > 0) && <PuzzleGrid wordLength={game.wordLength} label={t('{0}-letter puzzle board', game.wordLength)}>
              {Array.from({ length: game.attemptLimit }, (_, row) => {
                const result = game.guesses[row];
                const activeGuess = !result && row === game.guesses.length ? guess : '';
                const rejected = !result && row === game.guesses.length && rejectedAttempt > 0;
                const revealing = revealingGuess?.gameId === game.id && revealingGuess.row === row;
                const checking = !result && row === game.guesses.length && busy && submittingGuess.current;
                return <PuzzleGuessRow key={`${game.id}-${row}`} word={result?.guess ?? activeGuess} wordLength={game.wordLength} label={result?.guess ?? t('Guess {0}', row + 1)} states={result?.feedback.map(state => state.toLowerCase()) ?? []}
                  rejectedAttempt={rejected ? rejectedAttempt : 0} revealing={revealing} checking={checking} onRevealEnd={() => setRevealingGuess(null)}/>;
              })}
            </PuzzleGrid>}
            {finished && <div className="next-game" role="group" aria-label={t('Game actions')}><button ref={playAgainRef} className="primary-button" onClick={() => void startPractice(true)} disabled={busy || progressSaving || accountLoading || walletOwner !== (account?.id ?? 'guest')}>{t('Play again')}</button><button className="quiet-button" onClick={exitGame} disabled={busy || progressSaving}>{t('Change settings')}</button>{!account && !accountLoading && !accountError && game.status !== 'cancelled' && <p className="guest-save-reminder"><a href={sectionPaths.account} onClick={event => { event.preventDefault(); navigateTo('account'); }}>{t('Sign in to save your game history.')}</a></p>}</div>}
            {!finished && <>
              <label className="sr-only" htmlFor="guess-input">{t('Type your {0} guess one letter at a time', t(lengthName(game.wordLength)))}</label>
              <input ref={inputRef} className="game-input" id="guess-input" value={guess} readOnly onFocus={() => setGameInputFocused(true)} onBlur={() => setGameInputFocused(false)} onChange={event => changeGuess(event.target.value)} onPaste={event => event.preventDefault()} onDrop={event => event.preventDefault()} onKeyDown={handleInputKeyDown} autoComplete="off" autoCapitalize="none" inputMode="none" />
            </>}
            </div>
            {hintPanel(game.ladder ? 'nextWord' : 'definition')}
            </div>

            {!finished && <div className="keyboard-dock">
              <div className="game-keyboard" role="group" aria-label={t('On-screen keyboard')}>
                {keyboardRows.map((row, rowIndex) => <div className={`keyboard-row keyboard-row-${rowIndex + 1}`} key={row}>
                  {rowIndex === 2 && <button className="keyboard-key special-key enter-key" type="button" onMouseDown={event => event.preventDefault()} onClick={() => void submitGuess()} disabled={busy || progressSaving || finished || guess.length !== game.wordLength}>{t('Enter')}</button>}
                  {row.split('').map(letter => {
                    const state = keyboardFeedback.get(letter.toUpperCase())?.toLowerCase() ?? '';
                    return <button className={`keyboard-key ${state}`} key={letter} type="button" aria-label={`${letter.toUpperCase()}${state ? `, ${t(state)}` : ''}`} onMouseDown={event => event.preventDefault()} onClick={() => addLetter(letter)} disabled={busy || progressSaving || finished}>{letter}</button>;
                  })}
                  {rowIndex === 2 && <button className="keyboard-key special-key delete-key" type="button" aria-label={t('Delete letter')} onMouseDown={event => event.preventDefault()} onClick={deleteLetter} disabled={busy || progressSaving || finished}>⌫</button>}
                </div>)}
              </div>
            </div>}
            {(game.ladder || game.guesses.length > 0 || (finished && game.status !== 'cancelled')) && <aside className="puzzle-definitions" aria-label={t('Word definitions')}>
            {game.ladder && <div className="guess-definition">
              <div><div className="word-with-pronunciation"><strong>{game.ladder.startWord}</strong><PronunciationButton term={game.ladder.startWord}/></div><DefinitionText text={game.ladder.startDefinition || t('Definition unavailable.')}/></div>
              {wordBookmark(game.ladder.startWord, game.ladder.startDefinition ?? '')}
            </div>}
            {game.guesses.map((result, index) => <div className="guess-definition" key={`${result.guess}-${index}`}>
              <div><div className="word-with-pronunciation"><strong>{result.guess}</strong><PronunciationButton term={result.guess} /></div><DefinitionText text={result.definition || t('Definition unavailable.')} /></div>
              {wordBookmark(result.guess, result.definition ?? '')}
            </div>)}
            {finished && !game.ladder && game.answer && <div className="answer-definition">
              <div><p className="eyebrow">{t('THE ANSWER')}</p><div className="word-with-pronunciation"><strong>{game.answer}</strong><PronunciationButton term={game.answer!} /></div><DefinitionText text={game.answerDefinition || t('Definition unavailable.')} /></div>
              {wordBookmark(game.answer!, game.answerDefinition ?? '')}
            </div>}
            </aside>}

            </div>
          </div>
        )}
      {!game && message && <p className="notice" role="status">{t(message)}</p>}
      </section>
      </>
  );
}
