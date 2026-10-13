import { CSSProperties, KeyboardEvent, useEffect, useRef, useState } from 'react';
import AccountPage from './AccountPage';
import AccountStatus from './AccountStatus';
import useAccount from './useAccount';
import WordListsPanel from './WordListsPanel';
import GameCatalog from './GameCatalog';
import StatisticsPanel from './StatisticsPanel';
import PronunciationButton from './PronunciationButton';
import { normalizeTerm, rememberDictionaryDefinition } from './dictionary-cache';
import { ApiError, apiRequest as api } from './services/api-client';

type Feedback = 'CORRECT' | 'PRESENT' | 'ABSENT';
type Theme = 'dark' | 'light';
type Section = 'home' | 'play' | 'library' | 'progress' | 'community' | 'settings' | 'licenses' | 'account';
const sectionPaths: Record<Section, string> = {
  home: '/', play: '/games', library: '/library', progress: '/progress', community: '/community', settings: '/settings',
  licenses: '/licenses', account: '/account',
};
const pathSections = Object.fromEntries(Object.entries(sectionPaths).map(([section, path]) => [path, section])) as Record<string, Section>;
pathSections['/play'] = 'play';
function currentSection(): Section {
  const action = new URLSearchParams(window.location.hash.slice(1)).get('action');
  if (action === 'reset' || action === 'verify') return 'account';
  return pathSections[window.location.pathname] ?? 'home';
}
type GuessResult = {
  guess: string;
  feedback: Feedback[];
  attemptsRemaining: number;
  completed: boolean;
  outcome?: 'WON' | 'LOST';
  answer?: string;
  definition?: string;
  answerDefinition?: string;
};
type Game = { id: string; wordLength: number; difficulty?: string; attemptLimit: number; guesses: GuessResult[]; hints: { unused: number; present: number }; revealedAbsent: string[]; revealedPresent: string[] };
const LAST_GAME_KEY = 'lexiplay-last-game';
const difficulties = [{ id: 'easy', label: 'Easy', guesses: 7, hints: 3 }, { id: 'medium', label: 'Medium', guesses: 6, hints: 2 }, { id: 'hard', label: 'Hard', guesses: 5, hints: 1 }] as const;
type WordListSummary = { id: string; words: { term: string }[] };
const LOCAL_WORD_LISTS_KEY = 'lexiplay-local-word-lists';

function BookmarkIcon({ added }: { added: boolean }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 3.75h12a1 1 0 0 1 1 1v16l-7-4.5-7 4.5v-16a1 1 0 0 1 1-1Z" fill={added ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>;
}

function DefinitionText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = text.length > 150;
  return <>
    <span className={`definition-text${canExpand && !expanded ? ' collapsed' : ''}`}>{text}</span>
    {canExpand && <button type="button" className="learn-more" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Show less' : 'Learn more'}</button>}
  </>;
}

function savedDefinition(text: string) {
  const valueTrimmed = text.trim();
  const firstSemicolon = valueTrimmed.indexOf(';');
  const secondSemicolon = firstSemicolon < 0 ? -1 : valueTrimmed.indexOf(';', firstSemicolon + 1);
  const trimmed = secondSemicolon < 0 ? valueTrimmed : valueTrimmed.slice(0, secondSemicolon + 1).trim();
  return trimmed.length > 500 ? `${trimmed.slice(0, 499).trimEnd()}…` : trimmed;
}

const lengthName = (length: number) => `${['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][length]}-letter`;
const keyboardRows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const feedbackRank: Record<Feedback, number> = { ABSENT: 1, PRESENT: 2, CORRECT: 3 };

export default function App() {
  const { account, setAccount, loading: accountLoading, error: accountError, retry: retryAccount, signedIn, progressSaving, progressError, progressMessage, retryProgress } = useAccount();
  const [game, setGame] = useState<Game | null>(null);
  const [guess, setGuess] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [rejectedAttempt, setRejectedAttempt] = useState(0);
  const [selectedWordLength, setSelectedWordLength] = useState(5);
  const [selectedGameId, setSelectedGameId] = useState('word-puzzle');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [restoring, setRestoring] = useState(false);
  const [accountRevision, setAccountRevision] = useState(0);
  const [playWithMyWords, setPlayWithMyWords] = useState(false);
  const [addedWords, setAddedWords] = useState<Set<string>>(() => new Set());
  const [theme, setTheme] = useState<Theme>(() => window.localStorage.getItem('lexiplay-theme') === 'light' ? 'light' : 'dark');
  const [activeSection, setActiveSection] = useState<Section>(currentSection);
  const [quickSearch, setQuickSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const puzzleRef = useRef<HTMLDivElement>(null);
  const submittingGuess = useRef(false);
  const guessSession = useRef(0);

  useEffect(() => {
    const syncSection = () => {
      window.dispatchEvent(new Event('lexiplay:before-route-change'));
      const nextSection = currentSection();
      setQuickSearch('');
      setActiveSection(nextSection);
    };
    window.addEventListener('popstate', syncSection);
    return () => window.removeEventListener('popstate', syncSection);
  }, []);

  function navigateTo(section: Section, search?: string) {
    const path = sectionPaths[section];
    if (window.location.pathname !== path) window.dispatchEvent(new Event('lexiplay:before-route-change'));
    if (window.location.pathname !== path) window.history.pushState({}, '', path);
    if (section !== activeSection) setQuickSearch(search ?? '');
    setActiveSection(section);
  }

  function resetGame() {
    guessSession.current++;
    try { window.localStorage.removeItem(LAST_GAME_KEY); } catch { /* Storage may be unavailable. */ }
    setGame(null);
    setGuess('');
    setMessage('');
    setRejectedAttempt(0);
    setAddedWords(new Set());
  }

  useEffect(() => {
    let active = true;
    let id: string | null = null;
    try { id = window.localStorage.getItem(LAST_GAME_KEY); } catch { /* Resume is optional when storage is unavailable. */ }
    if (id) {
      setRestoring(true);
      api<Game>(`/games/${encodeURIComponent(id)}`).then(result => { if (active) setGame(result); }).catch(error => {
        if (!active) return;
        if (error instanceof ApiError && [401, 404].includes(error.status)) { try { window.localStorage.removeItem(LAST_GAME_KEY); } catch { /* Storage may be unavailable. */ } }
        else setMessage('Could not restore your puzzle. Reload to try again.');
      }).finally(() => { if (active) setRestoring(false); });
    }
    let revision = 0;
    const changed = (event: Event) => {
      active = false;
      const detail = (event as CustomEvent<{ resumeGameId?: string; keepGuestProgress?: boolean }>).detail;
      if (detail?.keepGuestProgress) { guessSession.current++; setGame(null); setGuess(''); setMessage(''); setRejectedAttempt(0); setAddedWords(new Set()); } else resetGame();
      setRestoring(false); setAccountRevision(value => value + 1);
      const currentRevision = ++revision;
      if (detail?.resumeGameId) {
        const resumeId = detail.resumeGameId;
        try { window.localStorage.setItem(LAST_GAME_KEY, resumeId); } catch { /* Resume remains available in this view. */ }
        setRestoring(true);
        api<Game>(`/games/${encodeURIComponent(resumeId)}`).then(result => { if (revision === currentRevision) setGame(result); }).catch(() => {
          if (revision === currentRevision) setMessage('Your puzzle is saved. Reload to resume it.');
        }).finally(() => { if (revision === currentRevision) setRestoring(false); });
      }
    };
    window.addEventListener('lexiplay:account-change', changed);
    return () => { active = false; revision++; window.removeEventListener('lexiplay:account-change', changed); };
  }, []);

  const finished = game?.guesses.at(-1)?.completed ?? false;
  const attemptsRemaining = game?.guesses.at(-1)?.attemptsRemaining ?? game?.attemptLimit ?? 0;

  useEffect(() => {
    if (game && !finished) inputRef.current?.focus({ preventScroll: true });
  }, [game?.id, game?.guesses.length, finished]);

  useEffect(() => {
    if (game && activeSection === 'play') puzzleRef.current?.scrollIntoView?.({ block: 'start' });
  }, [game?.id, activeSection]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('lexiplay-theme', theme);
  }, [theme]);

  async function startPractice() {
    if (progressSaving) return;
    setBusy(true);
    setMessage('');
    try {
      const newGame = await api<Game>('/games', {
        method: 'POST',
        body: JSON.stringify({ kind: 'word-puzzle', wordLength: selectedWordLength, difficulty, playWithMyWords }),
      });
      setGame({ ...newGame, hints: newGame.hints ?? { unused: 3, present: 3 }, revealedAbsent: newGame.revealedAbsent ?? [], revealedPresent: newGame.revealedPresent ?? [] });
      try { window.localStorage.setItem(LAST_GAME_KEY, newGame.id); } catch { /* Gameplay remains available without browser storage. */ }
      setGuess('');
      try {
        const lists = await api<WordListSummary[]>('/word-lists');
        setAddedWords(new Set(lists.flatMap(list => list.words.map(word => word.term))));
      } catch { setAddedWords(new Set()); }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not start practice.');
    } finally {
      setBusy(false);
    }
  }

  async function useHint(type: 'unused' | 'present') {
    if (!game || busy || progressSaving || finished) return;
    setBusy(true);
    setMessage('');
    setRejectedAttempt(0);
    try {
      const result = await api<{ type: string; letters?: string[]; letter?: string; hints: Game['hints'] }>(`/games/${game.id}/hints`, {
        method: 'POST', body: JSON.stringify({ type }),
      });
      setGame({ ...game, hints: result.hints,
        revealedAbsent: [...game.revealedAbsent, ...(result.letters ?? [])],
        revealedPresent: result.letter ? [...game.revealedPresent, result.letter] : game.revealedPresent,
      });
      setMessage(result.letter ? `${result.letter.toUpperCase()} is in the answer. Its position is still yours to find.` : `${result.letters?.map(letter => letter.toUpperCase()).join(', ')} ${result.letters?.length === 1 ? 'is' : 'are'} not in the answer.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not use this hint.');
    } finally {
      setBusy(false);
    }
  }

  async function addGameWord(term: string, definition: string) {
    try {
      const lists = await api<WordListSummary[]>('/word-lists');
      const list = lists[0];
      if (!list) throw new Error('Your word list is unavailable.');
      if (!list.words.some(word => normalizeTerm(word.term) === normalizeTerm(term))) {
        await api(`/word-lists/${list.id}/words`, { method: 'POST', body: JSON.stringify({ term, definition: savedDefinition(definition) }) });
      }
      setAddedWords(current => new Set(current).add(term));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        try {
          const stored = window.localStorage.getItem(LOCAL_WORD_LISTS_KEY);
          const lists = stored ? JSON.parse(stored) as { id: string; name: string; words: { id: string; term: string; definition: string; status: 'KNOWN' | 'UNFAMILIAR' }[] }[] : [];
          const localList = lists[0] ?? { id: '00000000-0000-4000-8000-000000000001', name: 'My words', words: [] };
          if (!localList.words.some(word => normalizeTerm(word.term) === normalizeTerm(term))) {
            localList.words.push({
              id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              term, definition: savedDefinition(definition),
              status: 'UNFAMILIAR',
            });
          }
          window.localStorage.setItem(LOCAL_WORD_LISTS_KEY, JSON.stringify([localList]));
          setAddedWords(current => new Set(current).add(term));
          return;
        } catch { /* Fall through to the request error if local storage is unavailable. */ }
      }
      setMessage(error instanceof Error ? error.message : 'Could not add this word.');
    }
  }

  async function submitGuess(nextGuess = guess) {
    if (!game || busy || submittingGuess.current || progressSaving || finished || nextGuess.length !== game.wordLength) return;
    submittingGuess.current = true;
    const session = guessSession.current;
    setBusy(true);
    setMessage('');
    try {
      const result = await api<GuessResult>(`/games/${game.id}/guesses`, {
        method: 'POST',
        body: JSON.stringify({ guess: nextGuess.trim().toLowerCase() }),
      });
      if (session !== guessSession.current) return;
      if (result.definition) rememberDictionaryDefinition(result.guess, result.definition);
      if (result.answer && result.answerDefinition) rememberDictionaryDefinition(result.answer, result.answerDefinition);
      setGame({ ...game, guesses: [...game.guesses, result] });
      setGuess('');
      setRejectedAttempt(0);
      if (result.completed) {
        setMessage(result.outcome === 'WON'
          ? 'You found it! A new word is ready whenever you are.'
          : `Practice complete. The answer was ${result.answer}.`);
      }
    } catch (error) {
      if (session !== guessSession.current) return;
      if (error instanceof ApiError && error.status === 400 && (error.code === 'INVALID_GUESS' || (!error.code && /valid.*word|dictionary/i.test(error.message)))) {
        setRejectedAttempt(value => value + 1);
        setMessage(`${nextGuess.toUpperCase()} is not in the dictionary. Try another word.`);
      } else setMessage(error instanceof Error ? error.message : 'Could not submit your guess. Press Enter to retry.');
    } finally {
      submittingGuess.current = false;
      setBusy(false);
    }
  }

  function changeGuess(nextGuess: string) {
    if (!game || busy || submittingGuess.current || progressSaving || finished || nextGuess === guess) return;
    const cleaned = nextGuess.toLowerCase().replace(/[^a-z]/g, '').slice(0, game.wordLength);
    setGuess(cleaned);
    setRejectedAttempt(0);
    setMessage('');
    if (cleaned.length === game.wordLength) void submitGuess(cleaned);
  }

  function addLetter(letter: string) {
    if (!game || busy || progressSaving || finished) return;
    if (guess.length < game.wordLength) changeGuess(`${guess}${letter}`);
    inputRef.current?.focus({ preventScroll: true });
  }

  function focusGameInput() {
    if (game && !finished) inputRef.current?.focus({ preventScroll: true });
  }

  function deleteLetter() {
    if (!game || busy || progressSaving || finished) return;
    changeGuess(guess.slice(0, -1));
    inputRef.current?.focus({ preventScroll: true });
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (/^[a-z]$/i.test(event.key) && event.key.length === 1) {
      event.preventDefault();
      addLetter(event.key.toLowerCase());
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      deleteLetter();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void submitGuess();
    } else if (event.key.length === 1) {
      event.preventDefault();
    }
  }

  const keyboardFeedback = new Map<string, Feedback>();
  for (const letter of game?.revealedAbsent ?? []) keyboardFeedback.set(letter.toUpperCase(), 'ABSENT');
  for (const letter of game?.revealedPresent ?? []) keyboardFeedback.set(letter.toUpperCase(), 'PRESENT');
  for (const result of game?.guesses ?? []) {
    result.guess.split('').forEach((letter, index) => {
      const key = letter.toUpperCase();
      const feedback = result.feedback[index]!;
      const previous = keyboardFeedback.get(key);
      if (!previous || feedbackRank[feedback] > feedbackRank[previous]) keyboardFeedback.set(key, feedback);
    });
  }

  const sectionTitle: Record<Section, string> = {
    home: 'Home', play: 'Games', library: 'Word List',
    progress: 'Statistics', community: 'Community', settings: 'Settings', licenses: 'Licenses', account: 'Account',
  };
  const navigation: { key: Section; icon: string }[] = [
    { key: 'home', icon: '⌂' }, { key: 'play', icon: '▦' }, { key: 'library', icon: '▤' },
    { key: 'progress', icon: '▥' }, { key: 'community', icon: '♧' }, { key: 'settings', icon: '⚙' },
  ];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="LexiPlay home" onClick={event => { event.preventDefault(); navigateTo('home'); }}><span className="brand-mark">L</span> LexiPlay</a>
        <nav aria-label="Main navigation" className="main-navigation">
          {navigation.map(item => <button type="button" key={item.key} aria-label={sectionTitle[item.key]} className={activeSection === item.key ? 'active' : ''} aria-current={activeSection === item.key ? 'page' : undefined} onClick={() => navigateTo(item.key)}><span className="nav-icon" aria-hidden="true">{item.icon}</span><span className="nav-label">{sectionTitle[item.key]}</span><span className="nav-mobile-label" aria-hidden="true">{item.key === 'library' ? 'Words' : item.key === 'progress' ? 'Stats' : item.key === 'community' ? 'People' : sectionTitle[item.key]}</span></button>)}
        </nav>
        <div className="sidebar-bottom"><p>Small steps, stronger words.</p></div>
      </aside>
      <div className="workspace">
      <header className="topbar">
        <div className="page-title"><h1>{sectionTitle[activeSection]}</h1></div>
        <div className="header-actions">
          <form className="header-search" role="search" onSubmit={event => { event.preventDefault(); navigateTo('library', quickSearch); }}>
            <label className="sr-only" htmlFor="quick-search">Search your words</label>
            <input id="quick-search" type="search" value={quickSearch} onChange={event => setQuickSearch(event.target.value)} placeholder="Search words" />
            <button type="submit" aria-label="Search words">⌕</button>
          </form>
          <AccountStatus account={account} loading={accountLoading} error={accountError} onOpen={() => navigateTo('account')} />
          <button className="theme-toggle" type="button" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}>
            <span aria-hidden="true">{theme === 'dark' ? '☼' : '☾'}</span> {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </header>

      {activeSection === 'play' && <>
      {!game && <GameCatalog selectedId={selectedGameId} onSelect={setSelectedGameId} />}
      {selectedGameId === 'word-puzzle' &&
      <section className="game-card" aria-label="Vocabulary puzzle" onClick={event => {
        const target = event.target;
        if (target instanceof Element && target.closest('button, input, a, select, textarea')) return;
        focusGameInput();
      }}>
        {!game ? (
          <div className="welcome-card">
            <div className="sample-grid" aria-hidden="true">
              {['G', 'R', 'O', 'W', 'S'].map((letter, index) => <span className={`sample-tile tile-${index}`} key={letter}>{letter}</span>)}
            </div>
            <h2>Ready to play?</h2>
            <section className="game-rules" aria-labelledby="game-rules-title">
              <h3 id="game-rules-title">Wordle rules</h3>
              <p>Find the hidden {selectedWordLength}-letter word in {difficulties.find(option => option.id === difficulty)!.guesses} guesses. Each full word checks automatically.</p>
              <div className="rule-colors"><span><i className="rule-swatch correct" aria-hidden="true" />Correct spot</span><span><i className="rule-swatch present" aria-hidden="true" />Wrong spot</span><span><i className="rule-swatch absent" aria-hidden="true" />Not in word</span></div>
              <p>Letters can repeat. Each colored match counts once. Invalid words don’t use a guess.</p>
            </section>
            <div className="practice-options">
              <fieldset className="length-options"><legend>Word length</legend>
                <div className="length-segments">
                  {[3, 4, 5, 6, 7, 8, 9].map(length => <label key={length} className={selectedWordLength === length ? 'selected' : ''}>
                    <input type="radio" name="word-length" value={length} checked={selectedWordLength === length} onChange={() => setSelectedWordLength(length)} aria-label={`${length} letters`} />
                    <span>{length}</span>
                  </label>)}
                </div>
              </fieldset>
              <fieldset className="difficulty-options"><legend>Difficulty</legend><div className="difficulty-segments">{difficulties.map(option => <label key={option.id} className={difficulty === option.id ? 'selected' : ''}><input type="radio" name="difficulty" checked={difficulty === option.id} onChange={() => setDifficulty(option.id)} /><strong>{option.label}</strong><small>{option.guesses} guesses · {option.hints} of each hint</small></label>)}</div></fieldset>
              <label className="word-pool-option"><span className="word-pool-icon" aria-hidden="true">▤</span><span><strong>Play with my words</strong><small>{playWithMyWords ? 'Answers from your saved vocabulary.' : 'Explore the full game dictionary.'}</small></span>
                <input type="checkbox" role="switch" aria-label="Play with my words" checked={playWithMyWords} onChange={event => setPlayWithMyWords(event.target.checked)} /><span className="option-switch" aria-hidden="true" />
              </label>
            </div>
            <button className="primary-button" onClick={startPractice} disabled={busy || progressSaving || restoring}>
              {progressSaving ? 'Saving your progress…' : restoring ? 'Restoring your puzzle…' : busy ? 'Getting a word…' : 'Start practice'} <span aria-hidden="true">→</span>
            </button>
          </div>
        ) : (
          <div ref={puzzleRef} className="puzzle">
            <div className="puzzle-heading">
              <div><p className="eyebrow">{game.difficulty ?? difficulty} · {game.wordLength} letters</p></div>
              <span className="attempt-counter" aria-live="polite">{attemptsRemaining} {attemptsRemaining === 1 ? 'guess' : 'guesses'} left</span>
            </div>
            {!finished && <div className="puzzle-tools"><button className="account-link" type="button" onClick={resetGame} disabled={busy || progressSaving}>Choose a new puzzle</button></div>}
            <p className={`puzzle-message${rejectedAttempt ? ' invalid' : ''}`} role="status" aria-live="polite">{message || (busy ? 'Checking…' : finished ? 'Puzzle complete.' : `Type ${game.wordLength} letters to check your word automatically.`)}</p>
            {!finished && (game.revealedPresent.length > 0 || game.revealedAbsent.length > 0) && <div className="puzzle-revealed-hints" aria-label="Revealed letters">
              {game.revealedPresent.length > 0 && <span>In the word: <strong>{game.revealedPresent.map(letter => letter.toUpperCase()).join(' · ')}</strong> · position unknown</span>}
              {game.revealedAbsent.length > 0 && <span>Ruled out: <strong>{game.revealedAbsent.map(letter => letter.toUpperCase()).join(' · ')}</strong></span>}
            </div>}
            <div className="puzzle-columns">
            <div className="puzzle-play-column">
            <div className="guess-board" role="grid" aria-label={`${game.wordLength}-letter puzzle board`} style={{ width: `calc(${game.wordLength} * var(--puzzle-tile-size, 3.6rem) + ${(game.wordLength - 1) * .35}rem)`, '--puzzle-attempts': game.attemptLimit } as CSSProperties}>
              {Array.from({ length: game.attemptLimit }, (_, row) => {
                const result = game.guesses[row];
                const activeGuess = !result && row === game.guesses.length ? guess : '';
                const rejected = !result && row === game.guesses.length && rejectedAttempt > 0;
                return <div className={`guess-row${rejected ? ' invalid-guess' : ''}`} role="row" aria-label={result?.guess ?? `Guess ${row + 1}`} key={`${row}-${rejected ? rejectedAttempt : 0}`} style={{ gridTemplateColumns: `repeat(${game.wordLength}, minmax(0, 1fr))` }}>
                  {Array.from({ length: game.wordLength }, (_, column) => {
                    const letter = result?.guess[column] ?? activeGuess[column] ?? '';
                    const state = result?.feedback[column]?.toLowerCase() ?? '';
                    return <span role="gridcell" aria-label={letter ? `${letter}, ${state || 'not submitted'}` : 'Empty'} className={`letter-tile ${state} ${letter && !state ? 'filled' : ''}`} style={{ fontSize: `clamp(1rem, calc(64cqi / ${game.wordLength}), 2.25rem)` }} key={column}>{letter}</span>;
                  })}
                </div>;
              })}
            </div>
            {!finished && <div className="game-consumables" aria-label="Hints">
              <button className="friendly-hint" type="button" onClick={() => void useHint('unused')} disabled={busy || progressSaving || game.hints.unused === 0}><span className="hint-icon" aria-hidden="true">⌫</span><span><strong>Remove letters</strong><small>Hide up to 3 incorrect letters</small></span><span className="hint-count">{game.hints.unused} left</span></button>
              <button className="friendly-hint" type="button" onClick={() => void useHint('present')} disabled={busy || progressSaving || game.hints.present === 0}><span className="hint-icon" aria-hidden="true">✦</span><span><strong>Reveal a letter</strong><small>Position stays hidden</small></span><span className="hint-count">{game.hints.present} left</span></button>
            </div>}
            {!finished && <>
              <label className="sr-only" htmlFor="guess-input">Type your {lengthName(game.wordLength)} guess one letter at a time</label>
              <input ref={inputRef} className="game-input" id="guess-input" value={guess} readOnly={busy || progressSaving} onChange={event => changeGuess(event.target.value)} onPaste={event => event.preventDefault()} onDrop={event => event.preventDefault()} onKeyDown={handleInputKeyDown} autoComplete="off" autoCapitalize="none" inputMode="text" />
            </>}
            </div>

            {!finished && <div className="keyboard-dock">
              <div className="game-keyboard" role="group" aria-label="On-screen keyboard">
                {keyboardRows.map((row, rowIndex) => <div className={`keyboard-row keyboard-row-${rowIndex + 1}`} key={row}>
                  {rowIndex === 2 && <button className="keyboard-key special-key enter-key" type="button" onMouseDown={event => event.preventDefault()} onClick={() => void submitGuess()} disabled={busy || progressSaving || finished || guess.length !== game.wordLength}>Enter</button>}
                  {row.split('').map(letter => {
                    const state = keyboardFeedback.get(letter.toUpperCase())?.toLowerCase() ?? '';
                    return <button className={`keyboard-key ${state}`} key={letter} type="button" aria-label={`${letter.toUpperCase()}${state ? `, ${state}` : ''}`} onMouseDown={event => event.preventDefault()} onClick={() => addLetter(letter)} disabled={busy || progressSaving || finished}>{letter}</button>;
                  })}
                  {rowIndex === 2 && <button className="keyboard-key special-key delete-key" type="button" aria-label="Delete letter" onMouseDown={event => event.preventDefault()} onClick={deleteLetter} disabled={busy || progressSaving || finished}>⌫</button>}
                </div>)}
              </div>
            </div>}
            {game.guesses.length > 0 && <aside className="puzzle-definitions" aria-label="Word definitions">
            {game.guesses.map((result, index) => <div className="guess-definition" key={`${result.guess}-${index}`}>
              <div><div className="word-with-pronunciation"><strong>{result.guess}</strong><PronunciationButton term={result.guess} /></div><DefinitionText text={result.definition || 'Definition unavailable.'} /></div>
              <button className="bookmark-button" type="button" aria-label={addedWords.has(result.guess) ? 'Already in word list' : `Save ${result.guess} to word list`} title={addedWords.has(result.guess) ? 'Already in word list' : 'Save to word list'} onClick={() => void addGameWord(result.guess, result.definition ?? '')} disabled={addedWords.has(result.guess)}><BookmarkIcon added={addedWords.has(result.guess)} />{addedWords.has(result.guess) && <span>Added</span>}</button>
            </div>)}
            {finished && game.guesses.at(-1)?.answer && <div className="answer-definition">
              <div><p className="eyebrow">THE ANSWER</p><div className="word-with-pronunciation"><strong>{game.guesses.at(-1)!.answer}</strong><PronunciationButton term={game.guesses.at(-1)!.answer!} /></div><DefinitionText text={game.guesses.at(-1)!.answerDefinition || 'Definition unavailable.'} /></div>
              <button className="bookmark-button" type="button" aria-label={addedWords.has(game.guesses.at(-1)!.answer!) ? 'Already in word list' : `Save ${game.guesses.at(-1)!.answer} to word list`} title={addedWords.has(game.guesses.at(-1)!.answer!) ? 'Already in word list' : 'Save to word list'} onClick={() => void addGameWord(game.guesses.at(-1)!.answer!, game.guesses.at(-1)!.answerDefinition ?? game.guesses.at(-1)!.definition ?? '')} disabled={addedWords.has(game.guesses.at(-1)!.answer!)}><BookmarkIcon added={addedWords.has(game.guesses.at(-1)!.answer!)} />{addedWords.has(game.guesses.at(-1)!.answer!) && <span>Added</span>}</button>
            </div>}
            </aside>}

            </div>
          </div>
        )}
      {!game && message && <p className="notice" role="status">{message}</p>}
      {finished && <div className="next-game"><button className="primary-button" onClick={resetGame}>Return</button></div>}
      </section>
      }
      </>}
      {activeSection === 'library' && <section className="library-page">
        <WordListsPanel key={accountRevision} pageMode searchQuery={quickSearch} />
      </section>}
      {activeSection === 'home' && <section className="overview-page">
        <div className="welcome-banner"><p className="eyebrow">A LITTLE PRACTICE GOES A LONG WAY</p><h2>Make room for a new word.</h2><p>Build a habit with a quick puzzle or spend a few minutes organizing your vocabulary.</p><button type="button" className="primary-button" onClick={() => navigateTo('play')}>Start a puzzle <span aria-hidden="true">→</span></button></div>
        <div className="overview-cards"><button type="button" onClick={() => navigateTo('library')}><span className="overview-icon" aria-hidden="true">▤</span><strong>Your word list</strong><span>Browse and add words</span><span className="card-arrow" aria-hidden="true">→</span></button><button type="button" onClick={() => navigateTo('play')}><span className="overview-icon" aria-hidden="true">▦</span><strong>Quick practice</strong><span>Solve a word puzzle</span><span className="card-arrow" aria-hidden="true">→</span></button><button type="button" onClick={() => navigateTo('progress')}><span className="overview-icon" aria-hidden="true">▥</span><strong>Learning progress</strong><span>Review your activity</span><span className="card-arrow" aria-hidden="true">→</span></button></div>
      </section>}
      {activeSection === 'account' && <AccountPage account={account} setAccount={setAccount} loading={accountLoading} accountError={accountError} onRetry={retryAccount} onSignedIn={signedIn} progressSaving={progressSaving} progressError={progressError} progressMessage={progressMessage} onRetryProgress={retryProgress} />}
      {activeSection === 'progress' && <StatisticsPanel key={accountRevision} />}
      {activeSection === 'community' && <section className="section-placeholder"><span aria-hidden="true">♧</span><h2>Learn alongside others.</h2><p>Community features are being planned. Your private word lists stay yours.</p></section>}
      {activeSection === 'settings' && <section className="settings-page"><h2>Appearance</h2><p>Choose the theme that feels comfortable.</p><button className="theme-toggle" type="button" onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☼ Light mode' : '☾ Dark mode'}</button></section>}
      {activeSection === 'licenses' && <section className="licenses-page" aria-label="Licenses and attribution">
        <p className="eyebrow">SOURCES & ATTRIBUTION</p><h2>Words with a shared history.</h2><p>Our dictionary starts with the work of the Simple English Wiktionary community.</p>
        <article><h3>Dictionary definitions</h3><p>Definitions are adapted from <a href="https://simple.wiktionary.org/" target="_blank" rel="noreferrer">Simple English Wiktionary</a>, under the <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noreferrer">Creative Commons Attribution-ShareAlike 3.0 license</a>, as described in the project’s <a href="https://simple.wiktionary.org/wiki/Wiktionary:Rules" target="_blank" rel="noreferrer">rules</a> and <a href="https://simple.wiktionary.org/wiki/Wiktionary:Copyrights" target="_blank" rel="noreferrer">copyright notice</a>.</p>
          <p>LexiPlay removes markup, normalizes spacing, and shortens definitions to the first two senses. Community definitions may vary in accuracy.</p>
          <p>Use <a href="https://simple.wiktionary.org/wiki/Special:Search" target="_blank" rel="noreferrer">Wiktionary’s entry search</a> to find an original word page and its contributors in the revision history. Shared adaptations remain subject to the applicable attribution and ShareAlike terms.</p>
        </article>
      </section>}
      <footer className="workspace-footer"><span>Thoughtful practice, one word at a time.</span><a href="/licenses" onClick={event => { event.preventDefault(); navigateTo('licenses'); }} aria-current={activeSection === 'licenses' ? 'page' : undefined}>Licenses</a><span className="footer-seed" aria-hidden="true">✳</span></footer>
      </div>
    </main>
  );
}
