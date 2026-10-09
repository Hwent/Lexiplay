import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import AccountPanel from './AccountPanel';
import WordListsPanel from './WordListsPanel';

type Feedback = 'CORRECT' | 'PRESENT' | 'ABSENT';
type Theme = 'dark' | 'light';
type Section = 'home' | 'play' | 'library' | 'progress' | 'community' | 'settings';
const sectionPaths: Record<Section, string> = {
  home: '/', play: '/play', library: '/library', progress: '/progress', community: '/community', settings: '/settings',
};
const pathSections = Object.fromEntries(Object.entries(sectionPaths).map(([section, path]) => [path, section])) as Record<string, Section>;
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
type Game = { id: string; wordLength: number; attemptLimit: number; guesses: GuessResult[]; hints: { unused: number; present: number }; revealedAbsent: string[]; revealedPresent: string[] };
type WordListSummary = { id: string; words: { term: string }[] };

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

const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message ?? 'Something went wrong. Please try again.');
  return payload as T;
};

const lengthName = (length: number) => `${['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'][length]}-letter`;
const keyboardRows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const feedbackRank: Record<Feedback, number> = { ABSENT: 1, PRESENT: 2, CORRECT: 3 };

export default function App() {
  const [game, setGame] = useState<Game | null>(null);
  const [guess, setGuess] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [selectedWordLength, setSelectedWordLength] = useState(5);
  const [playWithMyWords, setPlayWithMyWords] = useState(false);
  const [addedWords, setAddedWords] = useState<Set<string>>(() => new Set());
  const [theme, setTheme] = useState<Theme>(() => window.localStorage.getItem('lexiplay-theme') === 'light' ? 'light' : 'dark');
  const [activeSection, setActiveSection] = useState<Section>(() => pathSections[window.location.pathname] ?? 'home');
  const [quickSearch, setQuickSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const syncSection = () => {
      window.dispatchEvent(new Event('lexiplay:before-route-change'));
      const nextSection = pathSections[window.location.pathname] ?? 'home';
      if (nextSection !== 'play') resetGame();
      setActiveSection(nextSection);
    };
    window.addEventListener('popstate', syncSection);
    return () => window.removeEventListener('popstate', syncSection);
  }, []);

  function navigateTo(section: Section) {
    const path = sectionPaths[section];
    if (section !== 'play') resetGame();
    if (window.location.pathname !== path) window.dispatchEvent(new Event('lexiplay:before-route-change'));
    if (window.location.pathname !== path) window.history.pushState({}, '', path);
    setActiveSection(section);
  }

  function resetGame() {
    setGame(null);
    setGuess('');
    setMessage('');
    setAddedWords(new Set());
  }

  const finished = game?.guesses.at(-1)?.completed ?? false;
  const attemptsRemaining = game?.guesses.at(-1)?.attemptsRemaining ?? game?.attemptLimit ?? 0;

  useEffect(() => {
    if (game && !finished) inputRef.current?.focus({ preventScroll: true });
  }, [game?.id, game?.guesses.length, finished]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('lexiplay-theme', theme);
  }, [theme]);

  async function startPractice() {
    setBusy(true);
    setMessage('');
    try {
      const newGame = await api<Game>('/games', {
        method: 'POST',
        body: JSON.stringify({ wordLength: selectedWordLength, playWithMyWords }),
      });
      setGame({ ...newGame, hints: newGame.hints ?? { unused: 3, present: 3 }, revealedAbsent: newGame.revealedAbsent ?? [], revealedPresent: newGame.revealedPresent ?? [] });
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
    if (!game || busy || finished) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await api<{ type: string; letters?: string[]; letter?: string; hints: Game['hints'] }>(`/games/${game.id}/hints`, {
        method: 'POST', body: JSON.stringify({ type }),
      });
      setGame({ ...game, hints: result.hints,
        revealedAbsent: [...game.revealedAbsent, ...(result.letters ?? [])],
        revealedPresent: result.letter ? [...game.revealedPresent, result.letter] : game.revealedPresent,
      });
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
      if (!list.words.some(word => word.term === term)) {
        await api(`/word-lists/${list.id}/words`, { method: 'POST', body: JSON.stringify({ term, definition }) });
      }
      setAddedWords(current => new Set(current).add(term));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not add this word.');
    }
  }

  async function submitGuess() {
    if (!game || busy || finished || guess.length !== game.wordLength) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await api<GuessResult>(`/games/${game.id}/guesses`, {
        method: 'POST',
        body: JSON.stringify({ guess: guess.trim().toLowerCase() }),
      });
      setGame({ ...game, guesses: [...game.guesses, result] });
      setGuess('');
      if (result.completed) {
        setMessage(result.outcome === 'WON'
          ? 'You found it! A new word is ready whenever you are.'
          : `Practice complete. The answer was ${result.answer}.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not submit your guess.');
    } finally {
      setBusy(false);
    }
  }

  function addLetter(letter: string) {
    if (!game || busy || finished) return;
    setGuess(current => current.length < game.wordLength ? `${current}${letter}` : current);
    inputRef.current?.focus({ preventScroll: true });
  }

  function focusGameInput() {
    if (game && !finished) inputRef.current?.focus({ preventScroll: true });
  }

  function deleteLetter() {
    if (!game || busy || finished) return;
    setGuess(current => current.slice(0, -1));
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
    home: 'Home', play: 'Play', library: 'Word List',
    progress: 'Statistics', community: 'Community', settings: 'Settings',
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
          {navigation.map(item => <button type="button" key={item.key} className={activeSection === item.key ? 'active' : ''} aria-current={activeSection === item.key ? 'page' : undefined} onClick={() => navigateTo(item.key)}><span aria-hidden="true">{item.icon}</span>{sectionTitle[item.key]}</button>)}
        </nav>
        <div className="sidebar-bottom"><p>Small steps, stronger words.</p></div>
      </aside>
      <div className="workspace">
      <header className="topbar">
        <div className="page-title"><p className="eyebrow">YOUR LEARNING SPACE</p><h1>{sectionTitle[activeSection]}</h1></div>
        <div className="header-actions">
          <form className="header-search" role="search" onSubmit={event => { event.preventDefault(); navigateTo('library'); }}>
            <label className="sr-only" htmlFor="quick-search">Search your words</label>
            <input id="quick-search" type="search" value={quickSearch} onChange={event => setQuickSearch(event.target.value)} placeholder="Search words" />
            <button type="submit" aria-label="Search words">⌕</button>
          </form>
          <AccountPanel />
          <button className="theme-toggle" type="button" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}>
            <span aria-hidden="true">{theme === 'dark' ? '☼' : '☾'}</span> {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </header>

      {activeSection === 'play' && <>
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
            <h2>A fresh word is waiting.</h2>
            <p>Choose a word length, then solve it in six tries. You’ll get a hint after each guess.</p>
            <label className="length-picker" htmlFor="word-length">Word length</label>
            <select id="word-length" value={selectedWordLength} onChange={event => setSelectedWordLength(Number(event.target.value))}>
              {[3, 4, 5, 6, 7, 8].map(length => <option value={length} key={length}>{length} letters</option>)}
            </select>
            <label className="play-my-words"><input type="checkbox" checked={playWithMyWords} onChange={event => setPlayWithMyWords(event.target.checked)} /> Play with my words</label>
            <button className="primary-button" onClick={startPractice} disabled={busy}>
              {busy ? 'Getting a word…' : 'Start practice'} <span aria-hidden="true">→</span>
            </button>
          </div>
        ) : (
          <div className="puzzle">
            <div className="puzzle-heading">
              <div><p className="eyebrow">Today’s practice</p><h2>Find the word</h2></div>
              <span className="attempt-counter" aria-live="polite">{attemptsRemaining} {attemptsRemaining === 1 ? 'guess' : 'guesses'} left</span>
            </div>
            <div className="puzzle-columns">
            <div className="puzzle-play-column">
            <div className="guess-board" role="grid" aria-label={`${game.wordLength}-letter puzzle board`} style={{ width: `${game.wordLength * 5.2 + (game.wordLength - 1) * 0.45}rem` }}>
              {Array.from({ length: game.attemptLimit }, (_, row) => {
                const result = game.guesses[row];
                const activeGuess = !result && row === game.guesses.length ? guess : '';
                return <div className="guess-row" role="row" aria-label={result?.guess ?? `Guess ${row + 1}`} key={row} style={{ gridTemplateColumns: `repeat(${game.wordLength}, minmax(0, 1fr))` }}>
                  {Array.from({ length: game.wordLength }, (_, column) => {
                    const letter = result?.guess[column] ?? activeGuess[column] ?? '';
                    const state = result?.feedback[column]?.toLowerCase() ?? '';
                    return <span role="gridcell" aria-label={letter ? `${letter}, ${state || 'not submitted'}` : 'Empty'} className={`letter-tile ${state} ${letter && !state ? 'filled' : ''}`} key={column}>{letter}</span>;
                  })}
                </div>;
              })}
            </div>
            {!finished && <div className="game-consumables" aria-label="Hints">
              <button type="button" onClick={() => void useHint('unused')} disabled={busy || game.hints.unused === 0}><span className="hint-icon" aria-hidden="true">⌫</span> Remove 3 unused letters <small>{game.hints.unused} left</small></button>
              <button type="button" onClick={() => void useHint('present')} disabled={busy || game.hints.present === 0}><span className="hint-icon" aria-hidden="true">✦</span> Reveal a yellow letter <small>{game.hints.present} left</small></button>
            </div>}
            {!finished && <>
              {game.revealedPresent.length > 0 && <p className="revealed-letter-hint" aria-live="polite">{game.revealedPresent.map(letter => letter.toUpperCase()).join(' · ')} {game.revealedPresent.length === 1 ? 'is' : 'are'} in the answer; position unknown.</p>}
              <label className="sr-only" htmlFor="guess-input">Type your {lengthName(game.wordLength)} guess one letter at a time</label>
              <input ref={inputRef} className="game-input" id="guess-input" value={guess} onChange={event => setGuess(event.target.value.toLowerCase().replace(/[^a-z]/g, '').slice(0, game.wordLength))} onPaste={event => event.preventDefault()} onDrop={event => event.preventDefault()} onKeyDown={handleInputKeyDown} autoComplete="off" autoCapitalize="none" inputMode="text" />
            </>}
            </div>
            <aside className="puzzle-definitions" aria-label="Word definitions">
            {game.guesses.map((result, index) => <div className="guess-definition" key={`${result.guess}-${index}`}>
              <div><strong>{result.guess}</strong><DefinitionText text={result.definition || 'Definition unavailable.'} /></div>
              <button className="bookmark-button" type="button" aria-label={addedWords.has(result.guess) ? 'Already in word list' : `Save ${result.guess} to word list`} title={addedWords.has(result.guess) ? 'Already in word list' : 'Save to word list'} onClick={() => void addGameWord(result.guess, result.definition ?? '')} disabled={addedWords.has(result.guess)}><BookmarkIcon added={addedWords.has(result.guess)} />{addedWords.has(result.guess) && <span>Added</span>}</button>
            </div>)}
            {finished && game.guesses.at(-1)?.answer && <div className="answer-definition">
              <div><p className="eyebrow">THE ANSWER</p><strong>{game.guesses.at(-1)!.answer}</strong><DefinitionText text={game.guesses.at(-1)!.answerDefinition || 'Definition unavailable.'} /></div>
              <button className="bookmark-button" type="button" aria-label={addedWords.has(game.guesses.at(-1)!.answer!) ? 'Already in word list' : `Save ${game.guesses.at(-1)!.answer} to word list`} title={addedWords.has(game.guesses.at(-1)!.answer!) ? 'Already in word list' : 'Save to word list'} onClick={() => void addGameWord(game.guesses.at(-1)!.answer!, game.guesses.at(-1)!.answerDefinition ?? game.guesses.at(-1)!.definition ?? '')} disabled={addedWords.has(game.guesses.at(-1)!.answer!)}><BookmarkIcon added={addedWords.has(game.guesses.at(-1)!.answer!)} />{addedWords.has(game.guesses.at(-1)!.answer!) && <span>Added</span>}</button>
            </div>}
            </aside>
            {!finished && <div className="keyboard-dock">
              <div className="game-keyboard" role="group" aria-label="On-screen keyboard">
                {keyboardRows.map((row, rowIndex) => <div className={`keyboard-row keyboard-row-${rowIndex + 1}`} key={row}>
                  {rowIndex === 2 && <button className="keyboard-key special-key enter-key" type="button" onMouseDown={event => event.preventDefault()} onClick={() => void submitGuess()} disabled={busy || finished || guess.length !== game.wordLength}>Enter</button>}
                  {row.split('').map(letter => {
                    const state = keyboardFeedback.get(letter.toUpperCase())?.toLowerCase() ?? '';
                    return <button className={`keyboard-key ${state}`} key={letter} type="button" aria-label={`${letter.toUpperCase()}${state ? `, ${state}` : ''}`} onMouseDown={event => event.preventDefault()} onClick={() => addLetter(letter)} disabled={busy || finished}>{letter}</button>;
                  })}
                  {rowIndex === 2 && <button className="keyboard-key special-key delete-key" type="button" aria-label="Delete letter" onMouseDown={event => event.preventDefault()} onClick={deleteLetter} disabled={busy || finished}>⌫</button>}
                </div>)}
              </div>
              <p className="input-hint">Type one letter at a time or use the on-screen keyboard.</p>
            </div>}
            </div>
          </div>
        )}
      {message && <p className="notice" role="status">{message}</p>}
      {finished && <div className="next-game"><button className="primary-button" onClick={resetGame}>Return</button></div>}
      </section>
      </>}
      {activeSection === 'library' && <section className="library-page">
        <div className="section-intro"><div><p className="eyebrow">YOUR VOCABULARY</p><h2>Word List</h2><p>Keep the words you’re learning close at hand.</p></div><span className="library-mark" aria-hidden="true">✳</span></div>
        <WordListsPanel pageMode searchQuery={quickSearch} />
      </section>}
      {activeSection === 'home' && <section className="overview-page">
        <div className="welcome-banner"><p className="eyebrow">A LITTLE PRACTICE GOES A LONG WAY</p><h2>Make room for a new word.</h2><p>Build a habit with a quick puzzle or spend a few minutes organizing your vocabulary.</p><button type="button" className="primary-button" onClick={() => navigateTo('play')}>Start a puzzle <span aria-hidden="true">→</span></button></div>
        <div className="overview-cards"><button type="button" onClick={() => navigateTo('library')}><span className="overview-icon" aria-hidden="true">▤</span><strong>Your word list</strong><span>Browse and add words</span><span className="card-arrow" aria-hidden="true">→</span></button><button type="button" onClick={() => navigateTo('play')}><span className="overview-icon" aria-hidden="true">▦</span><strong>Quick practice</strong><span>Solve a word puzzle</span><span className="card-arrow" aria-hidden="true">→</span></button><button type="button" onClick={() => navigateTo('progress')}><span className="overview-icon" aria-hidden="true">▥</span><strong>Learning progress</strong><span>Review your activity</span><span className="card-arrow" aria-hidden="true">→</span></button></div>
      </section>}
      {activeSection === 'progress' && <section className="section-placeholder"><span aria-hidden="true">▥</span><h2>Your learning history will live here.</h2><p>Practice with words from your own lists to build a record of what you’ve learned.</p><button type="button" className="primary-button" onClick={() => navigateTo('library')}>Open your word list <span aria-hidden="true">→</span></button></section>}
      {activeSection === 'community' && <section className="section-placeholder"><span aria-hidden="true">♧</span><h2>Learn alongside others.</h2><p>Community features are being planned. Your private word lists stay yours.</p></section>}
      {activeSection === 'settings' && <section className="settings-page"><h2>Appearance</h2><p>Choose the theme that feels comfortable.</p><button className="theme-toggle" type="button" onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☼ Light mode' : '☾ Dark mode'}</button></section>}
      <footer className="workspace-footer"><span>Thoughtful practice, one word at a time.</span><span className="footer-seed" aria-hidden="true">✳</span></footer>
      </div>
    </main>
  );
}
