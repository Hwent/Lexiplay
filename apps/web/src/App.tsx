import { PendingWords } from './services/pending-words';
import { PendingWordsContext, useWordSelection } from './usePendingWords';
import Icon, { IconName } from './Icon';
import CollectionPicker from './CollectionPicker';
import { CSSProperties, KeyboardEvent, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import AccountStatus from './AccountStatus';
import useAccount from './useAccount';
import HomePage from './HomePage';
import PronunciationButton from './PronunciationButton';
import { normalizeTerm, rememberDictionaryDefinition, clearDictionaryCache } from './dictionary-cache';
import { ApiError, apiRequest as api } from './services/api-client';
import { readPracticePreferences, savePracticePreferences } from './practice-preferences';
import PuzzleCelebration from './PuzzleCelebration';
import { definitionHintText } from './hint-text';
import { gameAudio } from './services/game-audio';
import { GameOptions, GAME_OPTIONS_PATH, GAME_OPTIONS_LIFETIME } from './services/game-options';
import { createTranslator, LanguageContext, useTranslation } from './i18n';
import { useInterfacePreferences } from './interface-preferences';

const VocabularyLibrary = lazy(() => import('./VocabularyLibrary'));
const DictionaryPage = lazy(() => import('./DictionaryPage'));
const FeedbackPage = lazy(() => import('./FeedbackPage'));
const AccountPage = lazy(() => import('./AccountPage'));
const SettingsPage = lazy(() => import('./SettingsPage'));
const CommunityPage = lazy(() => import('./CommunityPage'));
const StatisticsPanel = lazy(() => import('./StatisticsPanel'));

type Feedback = 'CORRECT' | 'PRESENT' | 'ABSENT';
type Theme = 'dark' | 'light';
type Section = 'home' | 'play' | 'library' | 'dictionary' | 'feedback' | 'progress' | 'community' | 'settings' | 'licenses' | 'account';
const sectionPaths: Record<Section, string> = {
  home: '/', play: '/games', library: '/library', dictionary: '/dictionary', progress: '/progress', community: '/community', settings: '/settings',
  licenses: '/licenses', account: '/account', feedback: '/feedback',
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
  rewardCoins?: number;
};
type HintType = 'partOfSpeech' | 'definition';
type Game = { answer?: string; answerDefinition?: string; completed?: boolean; attemptCount?: number; coinChange?: number; pool?: { id: string; name: string; author: string }; id: string; wordLength: number; difficulty?: string; attemptLimit: number; guesses: GuessResult[]; hints: Record<HintType, number>; clues?: Partial<Record<HintType, string>>; hintCoinsSpent?: number; revealedAbsent: string[]; revealedPresent: string[]; status?: string; cancellationReason?: string; coinCost?: number; winRewardCoins?: number; coinPayer?: 'account' | 'guest' };
const LAST_GAME_KEY = 'lexiplay-last-game';
const difficulties = [{ id: 'easy', label: 'Easy', guesses: 7, reward: 4 }, { id: 'medium', label: 'Medium', guesses: 6, reward: 5 }, { id: 'hard', label: 'Hard', guesses: 5, reward: 6 }] as const;

function BookmarkIcon({ added }: { added: boolean }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 3.75h12a1 1 0 0 1 1 1v16l-7-4.5-7 4.5v-16a1 1 0 0 1 1-1Z" fill={added ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>;
}

function DefinitionText({ text }: { text: string }) {
  const t = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const canExpand = text.length > 150;
  return <>
    <span className={`definition-text${canExpand && !expanded ? ' collapsed' : ''}`}>{text}</span>
    {canExpand && <button type="button" className="learn-more" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? t('Show less') : t('Learn more')}</button>}
  </>;
}

function savedDefinition(text: string) {
  const trimmed = text.trim();
  return trimmed.length > 500 ? `${trimmed.slice(0, 499).trimEnd()}…` : trimmed;
}

const lengthName = (length: number) => `${['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][length]}-letter`;
const keyboardRows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const feedbackRank: Record<Feedback, number> = { ABSENT: 1, PRESENT: 2, CORRECT: 3 };

export default function App() {
  const interfacePreferences = useInterfacePreferences();
  const t = useMemo(() => createTranslator(interfacePreferences.language), [interfacePreferences.language]);
  const [preferences] = useState(readPracticePreferences);
  const { account, setAccount, loading: accountLoading, error: accountError, retry: retryAccount, signedIn, progressSaving, progressError, progressMessage, retryProgress } = useAccount();
  const [game, setGame] = useState<Game | null>(null);
  const [wallet, setWallet] = useState<{ coinBalance: number; kind: string } | null>(null);
  const [walletOwner, setWalletOwner] = useState<string | null>(null);
  const startRequest = useRef<{ key: string; id: string } | null>(null);
  const [guess, setGuess] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [rejectedAttempt, setRejectedAttempt] = useState(0);
  const [revealingGuess, setRevealingGuess] = useState<{ gameId: string; row: number } | null>(null);
  const [celebrationId, setCelebrationId] = useState('');
  const [selectedWordLength, setSelectedWordLength] = useState(preferences.wordLength);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>(preferences.difficulty);
  const [restoring, setRestoring] = useState(false);
  const [accountRevision, setAccountRevision] = useState(0);
  const [playWithMyWords, setPlayWithMyWords] = useState(preferences.playWithMyWords);
  const [selectedPoolId, setSelectedPoolId] = useState(preferences.collectionId);
  const wordStore = useMemo(() => new PendingWords(account?.id ?? 'guest'), [account?.id]);
  const wordSelection = useWordSelection(wordStore);
  const [theme, setTheme] = useState<Theme>(() => window.localStorage.getItem('lexiplay-theme') === 'light' ? 'light' : 'dark');
  const [soundEnabled, setSoundEnabled] = useState(() => gameAudio.enabled);
  useEffect(() => gameAudio.listen(), []);
  const [activeSection, setActiveSection] = useState<Section>(currentSection);
  const [quickSearch, setQuickSearch] = useState('');
  useEffect(() => {
    if (accountLoading) return;
    const timer = window.setTimeout(() => {
      void wordStore.requests.get<GameOptions[]>(GAME_OPTIONS_PATH, GAME_OPTIONS_LIFETIME).catch(() => {});
    }, 500);
    return () => window.clearTimeout(timer);
  }, [accountLoading, wordStore]);
  useEffect(() => {
    savePracticePreferences({ wordLength: selectedWordLength, difficulty, collectionId: selectedPoolId, playWithMyWords });
  }, [selectedWordLength, difficulty, selectedPoolId, playWithMyWords]);
  useEffect(() => {
    if (!celebrationId) return;
    if (activeSection !== 'play') { setCelebrationId(''); return; }
    const timer = window.setTimeout(() => setCelebrationId(''), 2800);
    return () => window.clearTimeout(timer);
  }, [celebrationId, activeSection]);
  useEffect(() => { document.documentElement.scrollTop = 0; }, [activeSection]);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      const target = event.target;
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented
        || target instanceof HTMLElement && (target.isContentEditable || !!target.closest('input, textarea, select, [role="textbox"]'))) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  const puzzleRef = useRef<HTMLDivElement>(null);
  const submittingGuess = useRef(false);
  const guessSession = useRef(0);

  const activeSectionRef = useRef(activeSection);
  activeSectionRef.current = activeSection;
  const navigating = useRef(false);
  useEffect(() => {
    if (!accountLoading && (activeSection === 'play' || activeSection === 'library')) void wordStore.loadSaved().catch(() => {});
  }, [accountLoading, activeSection, wordStore]);
  useEffect(() => {
    const syncSection = () => {
      const nextSection = currentSection();
      if (navigating.current) { window.history.pushState({}, '', sectionPaths[activeSectionRef.current]); return; }
      const commit = () => {
        window.dispatchEvent(new Event('lexiplay:before-route-change'));
        setQuickSearch(''); setActiveSection(nextSection);
      };
      const words = wordStore.getSnapshot();
      if (!words.pending.size && !words.saving) { commit(); return; }
      navigating.current = true;
      void wordStore.flush().then(commit).catch(() => { window.history.pushState({}, '', sectionPaths[activeSectionRef.current]); }).finally(() => { navigating.current = false; });
    };
    const leaving = () => { void wordStore.flush(true).catch(() => {}); };
    window.addEventListener('popstate', syncSection);
    window.addEventListener('pagehide', leaving);
    return () => { window.removeEventListener('popstate', syncSection); window.removeEventListener('pagehide', leaving); };
  }, [wordStore]);

  function navigateTo(section: Section, search?: string) {
    const commit = () => {
      const path = sectionPaths[section];
      if (window.location.pathname !== path) { window.dispatchEvent(new Event('lexiplay:before-route-change')); window.history.pushState({}, '', path); }
      if (section !== activeSection) setQuickSearch(search ?? '');
      setActiveSection(section);
    };
    if (section === activeSection || (!wordSelection.pending.size && !wordSelection.saving)) { commit(); return; }
    if (navigating.current) return;
    navigating.current = true;
    void wordStore.flush().then(commit).catch(() => {}).finally(() => { navigating.current = false; });
  }

  async function exitGame() {
    if (busy) return;
    setBusy(true);
    try {
      await wordStore.flush();
      if (game && !finished) await api(`/games/${game.id}/abandon`, { method: 'POST' });
      resetGame();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not leave your puzzle. Try again.'); }
    finally { setBusy(false); }
  }
  async function useCollection(poolId:string) {
    if (busy) return;
    setBusy(true);
    try {
      await wordStore.flush();
      if (game && !finished) await api(`/games/${game.id}/abandon`, { method: 'POST' });
      resetGame(); setSelectedPoolId(poolId); setPlayWithMyWords(false); navigateTo('play');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not change your puzzle. Try again.'); }
    finally { setBusy(false); }
  }

  function resetGame() {
    guessSession.current++;
    try { window.localStorage.removeItem(LAST_GAME_KEY); } catch { /* Storage may be unavailable. */ }
    setGame(null);
    setGuess('');
    setMessage('');
    setRejectedAttempt(0);
    setCelebrationId('');
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
      if (detail?.keepGuestProgress) { guessSession.current++; setGame(null); setGuess(''); setMessage(''); setRejectedAttempt(0); } else resetGame();
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

  const finished = game?.completed || game?.status === 'cancelled' || (game?.guesses.at(-1)?.completed ?? false);
  const attemptsRemaining = game ? Math.max(0,game.attemptLimit - (game.attemptCount ?? game.guesses.length)) : 0;

  useEffect(() => {
    if (accountLoading) return;
    let active = true;
    api<{coinBalance:number;kind:string}>('/games/wallet').then(value => {
      if (active && Number.isInteger(value.coinBalance)) setWallet(value);
    }).catch(() => { if (active) setWallet(null); }).finally(() => {
      if (active) setWalletOwner(account?.id ?? 'guest');
    });
    return () => { active = false; };
  }, [account?.id, accountLoading, game?.id, game?.guesses.length, game?.hintCoinsSpent]);

  useEffect(() => {
    let active = true;
    wordStore.requests.get<{version:string}>('/library/revision', 60_000).then(value => {
      if (!active || typeof value.version !== 'string') return;
      let previous: string | null = null;
      try {
        previous = localStorage.getItem('lexiplay-library-revision');
        localStorage.setItem('lexiplay-library-revision', value.version);
      } catch { /* The current view still uses the server's published data. */ }
      if (previous !== value.version) {
        clearDictionaryCache();
        wordStore.requests.invalidate();
        wordStore.requests.prime('/library/revision', value, 60_000);
        void wordStore.loadSaved(true).catch(() => {});
        setAccountRevision(revision => revision + 1);
        if (game) void api<Game>(`/games/${game.id}`).then(updated => { if (active) setGame(updated); }).catch(() => {});
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [activeSection, wordStore]);

  useEffect(() => {
    if (game && !finished && activeSection === 'play') inputRef.current?.focus({ preventScroll: true });
  }, [game?.id, game?.guesses.length, finished, activeSection]);

  useEffect(() => {
    if (activeSection !== 'play') setRevealingGuess(null);
  }, [activeSection]);

  useEffect(() => {
    if (game && activeSection === 'play') puzzleRef.current?.scrollIntoView?.({ block: 'start' });
  }, [game?.id, activeSection]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('lexiplay-theme', theme);
  }, [theme]);

  async function startPractice(replay = false) {
    if (progressSaving || accountLoading || walletOwner !== (account?.id ?? 'guest')) return;
    setBusy(true);
    setMessage('');
    try {
      await wordStore.flush();
      const options = { kind: 'word-puzzle', wordLength: replay && game ? game.wordLength : selectedWordLength,
        difficulty: replay && game ? game.difficulty ?? difficulty : difficulty, playWithMyWords,
        ...(!playWithMyWords && selectedPoolId ? { collectionId: selectedPoolId } : {}) };
      const key = JSON.stringify([account?.id ?? 'guest', options]);
      if (startRequest.current?.key !== key) {
        try {
          const pending = JSON.parse(localStorage.getItem('lexiplay-start-request') ?? 'null');
          startRequest.current = pending?.key === key && typeof pending.id === 'string' ? pending : null;
        } catch { startRequest.current = null; }
        startRequest.current ??= { key, id: crypto.randomUUID() };
      }
      try { localStorage.setItem('lexiplay-start-request', JSON.stringify(startRequest.current)); } catch { /* The in-memory request still prevents repeat charges. */ }
      const newGame = await api<Game>('/games', {
        method: 'POST',
        body: JSON.stringify({ ...options, startRequestId: startRequest.current.id }),
      });
      guessSession.current++;
      setCelebrationId('');
      setRejectedAttempt(0);
      setGame({ ...newGame, hints: newGame.hints ?? { partOfSpeech: 1, definition: 1 }, revealedAbsent: newGame.revealedAbsent ?? [], revealedPresent: newGame.revealedPresent ?? [] });
      try { window.localStorage.setItem(LAST_GAME_KEY, newGame.id); } catch { /* Gameplay remains available without browser storage. */ }
      setGuess('');
      startRequest.current = null;
      try { localStorage.removeItem('lexiplay-start-request'); } catch { /* The game is already available in this view. */ }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not start practice.');
    } finally {
      setBusy(false);
    }
  }

  async function useHint(type: HintType) {
    if (!game || busy || progressSaving || finished) return;
    const session = guessSession.current;
    setBusy(true);
    setMessage('');
    setRejectedAttempt(0);
    try {
      const result = await api<{ type: HintType; text: string; hints: Game['hints']; cost: number }>(`/games/${game.id}/hints`, {
        method: 'POST', body: JSON.stringify({ type }),
      });
      if (session !== guessSession.current) return;
      setGame({ ...game, hints: result.hints, clues: { ...game.clues, [type]: result.text }, hintCoinsSpent: (game.hintCoinsSpent ?? 0) + result.cost });
      if (activeSectionRef.current === 'play') gameAudio.play('hint');
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not use this hint.');
    } finally {
      setBusy(false);
    }
  }

  function hintPanel(type: HintType) {
    if (!game || finished) return null;
    const title = type === 'partOfSpeech' ? 'Part of speech' : 'Definition';
    const clue = game.clues?.[type];
    return <aside className={`puzzle-hint hint-${type}`} aria-label={t('{0} hint', t(title))}>
      <button className="friendly-hint" type="button" aria-label={t('{0} hint · {1}', t(title), (clue ? t('Revealed') : t('1 coin')))} onClick={() => void useHint(type)} disabled={busy || progressSaving || !!clue || game.hints[type] === 0}>
        <span className="hint-icon" aria-hidden="true"><Icon name={type === 'partOfSpeech' ? 'dictionary' : 'library'}/></span><strong>{t(title)}</strong><span className="hint-price">{clue ? <Icon name="check"/> : <><Icon name="coin"/>1</>}</span>
      </button>
      {clue && <p className="hint-clue">{type === 'definition' ? definitionHintText(clue) : clue}</p>}
    </aside>;
  }

  function wordBookmark(term: string, definition: string) {
    const normalized = normalizeTerm(term);
    const saved = wordSelection.saved.has(normalized);
    const pending = wordSelection.pending.has(normalized);
    return <button className="bookmark-button" type="button" aria-label={saved ? t('Already in word list') : pending ? t('Cancel addition of {0}', term) : t('Add {0} to word list', term)} aria-pressed={pending} title={saved ? t('Saved in word list') : pending ? t('Cancel addition') : t('Add to word list')} onClick={() => wordStore.toggle(term, savedDefinition(definition))} disabled={saved || wordSelection.saving || accountLoading}><BookmarkIcon added={saved || pending}/><span>{saved ? t('Saved') : pending ? t('Cancel addition') : t('Add')}</span></button>;
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
      if (activeSectionRef.current === 'play') gameAudio.play(result.completed ? result.outcome === 'WON' ? 'win' : 'complete' : 'guess');
      if (result.answer && result.answerDefinition) rememberDictionaryDefinition(result.answer, result.answerDefinition);
      setRevealingGuess({ gameId: game.id, row: game.guesses.length });
      setGame({ ...game, guesses: [...game.guesses, result], attemptCount: game.guesses.length + 1, completed: result.completed,
        ...(result.completed ? { status: result.outcome === 'WON' ? 'won' : 'lost', answer: result.answer, answerDefinition: result.answerDefinition } : {}) });
      setGuess('');
      setRejectedAttempt(0);
      if (result.completed) {
        wordStore.requests.invalidate('/progress/');
        if (result.outcome === 'WON') setCelebrationId(game.id);
        setMessage(result.outcome === 'WON'
          ? result.rewardCoins ? `You found it! ${result.rewardCoins} coins earned${game.coinPayer === 'guest' && account ? ' in your guest wallet' : ''}.` : 'You found it! A new word is ready whenever you are.'
          : `Practice complete. The answer was ${result.answer}.`);
      }
    } catch (error) {
      if (session !== guessSession.current) return;
      if (error instanceof ApiError && error.status === 400 && (error.code === 'INVALID_GUESS' || (!error.code && /valid.*word|dictionary/i.test(error.message)))) {
        setRejectedAttempt(value => value + 1);
        if (activeSectionRef.current === 'play') gameAudio.play('invalid');
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
    if (cleaned === guess) return;
    gameAudio.play(cleaned.length < guess.length ? 'delete' : 'type');
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
    if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;
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
    home: t('Home'), play: t('Games'), library: t('Words'), dictionary: t('Dictionary'),
    progress: t('Stats'), community: t('Community'), settings: t('Settings'), licenses: t('Licenses'), account: t('Account'), feedback: t('Feedback'),
  };
  const navigation: { key: Section; icon: IconName }[] = [
    { key: 'play', icon: 'play' }, { key: 'library', icon: 'library' },
    { key: 'dictionary', icon: 'dictionary' },
    { key: 'progress', icon: 'progress' }, { key: 'settings', icon: 'settings' },
  ];
  const statsSections = [{ key: 'progress', label: 'Overview' }, { key: 'community', label: 'Community' }] as const;
  const settingsSections = [{ key: 'settings', label: 'Preferences' }, { key: 'account', label: 'Account' }, { key: 'feedback', label: 'Feedback' }] as const;
  const activeNavigationSection = activeSection === 'community' ? 'progress' : activeSection === 'feedback' || activeSection === 'account' ? 'settings' : activeSection;
  const sectionNavigation = activeNavigationSection === 'progress' ? statsSections : activeNavigationSection === 'settings' ? settingsSections : null;

  return (
    <LanguageContext.Provider value={interfacePreferences.language}><PendingWordsContext.Provider value={wordStore}><main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label={t('LexiPlay home')} onClick={event => { event.preventDefault(); navigateTo('home'); }}><span className="brand-mark">L</span>{t(' LexiPlay')}</a>
        <nav aria-label={t('Main navigation')} className="main-navigation">
          {navigation.map(item => <button type="button" key={item.key} aria-label={sectionTitle[item.key]} className={activeNavigationSection === item.key ? 'active' : ''} aria-current={activeNavigationSection === item.key ? 'page' : undefined} onClick={() => navigateTo(item.key)}><span className="nav-icon" aria-hidden="true"><Icon name={item.icon}/></span><span className="nav-label">{sectionTitle[item.key]}</span><span className="nav-mobile-label" aria-hidden="true">{sectionTitle[item.key]}</span></button>)}
        </nav>
      </aside>
      <div className="workspace">
      <header className="topbar">
        <div className="page-title"><h1>{sectionTitle[activeNavigationSection]}</h1></div>
        <div className="header-actions">
          <form className="header-search" role="search" onSubmit={event => { event.preventDefault(); navigateTo('dictionary', quickSearch); }}>
            <label className="sr-only" htmlFor="quick-search">{t('Quick dictionary search')}</label>
            <input ref={searchRef} id="quick-search" type="search" value={quickSearch} onChange={event => setQuickSearch(event.target.value)} placeholder={t('Search the dictionary')} aria-keyshortcuts="/" onKeyDown={event => { if (event.key === 'Escape') event.currentTarget.blur(); }} />
            <kbd aria-hidden="true">/</kbd>
            <button type="submit" aria-label={t('Search dictionary')}><Icon name="search"/></button>
          </form>
          <AccountStatus coinBalance={walletOwner === (account?.id ?? 'guest') ? wallet?.coinBalance : account?.coinBalance} account={account} loading={accountLoading} error={accountError} onOpen={() => navigateTo('account')} />
          <button className="theme-toggle" type="button" aria-label={t('Switch to {0} mode', (theme === 'dark' ? t('light') : t('dark')))} onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'}/> {theme === 'dark' ? t('Light mode') : t('Dark mode')}
          </button>
        </div>
      </header>
      {wordSelection.error && <p className="word-selection-error" role="alert">{t(wordSelection.error)}</p>}
      {wordSelection.notice && <p className="word-selection-error" role="alert">{t(wordSelection.notice)}</p>}
      {sectionNavigation && <nav className="section-navigation" aria-label={activeNavigationSection === 'progress' ? t('Stats sections') : t('Settings sections')}>
        {sectionNavigation.map(item => <a key={item.key} href={sectionPaths[item.key]} aria-current={activeSection === item.key ? 'page' : undefined} onClick={event => { event.preventDefault(); navigateTo(item.key); }}>{t(item.label)}</a>)}
      </nav>}

      {activeSection === 'play' && <>
      {!game && <div className="page-introduction"><div><h2>{t('Choose your ')}<span>{t('challenge.')}</span></h2></div><span className="page-intro-icon" aria-hidden="true"><Icon name="play" /></span></div>}
      <section className="game-card" aria-label={t('Vocabulary puzzle')} aria-busy={busy || progressSaving || restoring} onClick={event => {
        const target = event.target;
        if (target instanceof Element && target.closest('button, input, a, select, textarea')) return;
        focusGameInput();
      }}>
        {!game ? (
          <div className="welcome-card">
            <div className="practice-story">
            <div className="sample-grid" aria-hidden="true">
              {['G', 'R', 'O', 'W', 'S'].map((letter, index) => <span className={`sample-tile tile-${index}`} key={letter}>{letter}</span>)}
            </div>
            <h2>{t('Word puzzle')}</h2>
            <details className="game-rules">
              <summary>{t('Wordle rules')}</summary>
              <p>{t('Find the hidden {0}-letter word in {1} guesses. Each full word checks automatically.', selectedWordLength, difficulties.find(option => option.id === difficulty)!.guesses)}</p>
              <div className="rule-colors"><span><i className="rule-swatch correct" aria-hidden="true" />{t('Correct spot')}</span><span><i className="rule-swatch present" aria-hidden="true" />{t('Wrong spot')}</span><span><i className="rule-swatch absent" aria-hidden="true" />{t('Not in word')}</span></div>
              <p>{t('Letters can repeat. Each colored match counts once. Invalid words don’t use a guess.')}</p>
            </details>
            </div>
            <div className="practice-setup">
            <div className="practice-setup-heading"><h3>{t('Puzzle options')}</h3></div>
            <div className="practice-options">
              <fieldset className="length-options"><legend>{t('Word length')}</legend>
                <div className="length-segments">
                  {[3, 4, 5, 6, 7, 8, 9].map(length => <label key={length} className={selectedWordLength === length ? 'selected' : ''}>
                    <input type="radio" name="word-length" value={length} checked={selectedWordLength === length} onChange={() => setSelectedWordLength(length)} aria-label={t('{0} letters', length)} />
                    <span>{length}</span>
                  </label>)}
                </div>
              </fieldset>
              <fieldset className="difficulty-options"><legend>{t('Difficulty')}</legend><div className="difficulty-segments">{difficulties.map(option => <label key={option.id} className={difficulty === option.id ? 'selected' : ''}><input type="radio" name="difficulty" checked={difficulty === option.id} onChange={() => setDifficulty(option.id)} /><strong>{t(option.label)}</strong></label>)}</div></fieldset>
              <CollectionPicker value={playWithMyWords ? 'my-words' : selectedPoolId} wordLength={selectedWordLength} disabled={busy} personalAvailable={!!account} onChange={id => {
                setPlayWithMyWords(id === 'my-words');
                if (id !== 'my-words') setSelectedPoolId(id);
              }} />
            </div>
            <div className="game-price" aria-label={t('Entry: 1 coin. Win: {0} coins', difficulties.find(option => option.id === difficulty)!.reward)}><span><Icon name="coin"/>{t('1 to play')}</span><span><Icon name="coin"/>+{difficulties.find(option => option.id === difficulty)!.reward}{t(' on a win')}</span></div>
            <button className="primary-button" onClick={() => void startPractice()} disabled={busy || progressSaving || restoring || accountLoading || walletOwner !== (account?.id ?? 'guest')}>{t('Start practice ')}<Icon name="arrow"/>
            </button>
            </div>
          </div>
        ) : (
          <div ref={puzzleRef} key={game.id} className={`puzzle${celebrationId === game.id ? ' puzzle-won' : ''}`}>
            {celebrationId === game.id && <PuzzleCelebration key={game.id}/>}
            <div className="puzzle-heading">
              <div><p className="eyebrow">{t('{0} · {1} letters', t(game.difficulty ?? difficulty), game.wordLength)}</p>{game.pool && <small>{t(game.pool.name)} · {game.pool.author}</small>}</div>
              <span className="attempt-counter" aria-live="polite">{t('{0} {1} left', attemptsRemaining, (attemptsRemaining === 1 ? t('guess') : t('guesses')))}</span>
            </div>
            {!finished && <div className="puzzle-tools"><button className="account-link" type="button" onClick={exitGame} disabled={busy || progressSaving}>{t('Choose a new puzzle')}</button></div>}
            <p className={`puzzle-message${rejectedAttempt ? ' invalid' : ''}`} role="status" aria-live="polite">{game.cancellationReason ? t(game.cancellationReason) + t(' Your entry cost was returned to the original wallet.') : message ? t(message) : finished ? t('{0} in {1} guesses.', t(game.status === 'won' ? 'Solved' : 'Puzzle complete'), game.attemptCount ?? game.guesses.length) : t('Type {0} letters to check your word automatically.', game.wordLength)}</p>
            {!finished && (game.revealedPresent.length > 0 || game.revealedAbsent.length > 0) && <div className="puzzle-revealed-hints" aria-label={t('Revealed letters')}>
              {game.revealedPresent.length > 0 && <span>{t('In the word: ')}<strong>{game.revealedPresent.map(letter => letter.toUpperCase()).join(' · ')}</strong>{t(' · position unknown')}</span>}
              {game.revealedAbsent.length > 0 && <span>{t('Ruled out: ')}<strong>{game.revealedAbsent.map(letter => letter.toUpperCase()).join(' · ')}</strong></span>}
            </div>}
            <div className="puzzle-columns">
            <div className={`puzzle-stage${!finished ? ' with-hints' : ''}`}>
            {hintPanel('partOfSpeech')}
            <div className="puzzle-play-column">
            {(!finished || game.guesses.length > 0) && <div className="guess-board" role="grid" aria-label={t('{0}-letter puzzle board', game.wordLength)} style={{ width: `calc(${game.wordLength} * var(--puzzle-tile-size, 3.6rem) + ${(game.wordLength - 1) * .35}rem)`, '--puzzle-attempts': game.attemptLimit } as CSSProperties}>
              {Array.from({ length: game.attemptLimit }, (_, row) => {
                const result = game.guesses[row];
                const activeGuess = !result && row === game.guesses.length ? guess : '';
                const rejected = !result && row === game.guesses.length && rejectedAttempt > 0;
                const revealing = revealingGuess?.gameId === game.id && revealingGuess.row === row;
                const checking = !result && row === game.guesses.length && busy && submittingGuess.current;
                return <div className={`guess-row${rejected ? ' invalid-guess' : ''}${revealing ? ' revealing-guess' : ''}${checking ? ' checking-guess' : ''}`} role="row" aria-label={result?.guess ?? t('Guess {0}', row + 1)} aria-busy={checking || undefined} key={`${game.id}-${row}-${rejected ? rejectedAttempt : 0}`} onAnimationEnd={event => {
                  if (event.animationName === 'puzzle-tile-reveal' && event.target === event.currentTarget.lastElementChild) setRevealingGuess(null);
                }} style={{ gridTemplateColumns: `repeat(${game.wordLength}, minmax(0, 1fr))` }}>
                  {Array.from({ length: game.wordLength }, (_, column) => {
                    const letter = result?.guess[column] ?? activeGuess[column] ?? '';
                    const state = result?.feedback[column]?.toLowerCase() ?? '';
                    return <span role="gridcell" aria-label={letter ? `${letter}, ${t(state || 'not submitted')}` : t('Empty')} className={`letter-tile ${state} ${letter && !state ? 'filled' : ''}`} style={{ fontSize: `clamp(1rem, calc(64cqi / ${game.wordLength}), 2.25rem)` }} key={`${column}-${letter}`}>{letter}</span>;
                  })}
                </div>;
              })}
            </div>}
            {!finished && <>
              <label className="sr-only" htmlFor="guess-input">{t('Type your {0} guess one letter at a time', t(lengthName(game.wordLength)))}</label>
              <input ref={inputRef} className="game-input" id="guess-input" value={guess} readOnly onChange={event => changeGuess(event.target.value)} onPaste={event => event.preventDefault()} onDrop={event => event.preventDefault()} onKeyDown={handleInputKeyDown} autoComplete="off" autoCapitalize="none" inputMode="none" />
            </>}
            </div>
            {hintPanel('definition')}
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
            {(game.guesses.length > 0 || (finished && game.status !== 'cancelled')) && <aside className="puzzle-definitions" aria-label={t('Word definitions')}>
            {game.guesses.map((result, index) => <div className="guess-definition" key={`${result.guess}-${index}`}>
              <div><div className="word-with-pronunciation"><strong>{result.guess}</strong><PronunciationButton term={result.guess} /></div><DefinitionText text={result.definition || t('Definition unavailable.')} /></div>
              {wordBookmark(result.guess, result.definition ?? '')}
            </div>)}
            {finished && game.answer && <div className="answer-definition">
              <div><p className="eyebrow">{t('THE ANSWER')}</p><div className="word-with-pronunciation"><strong>{game.answer}</strong><PronunciationButton term={game.answer!} /></div><DefinitionText text={game.answerDefinition || t('Definition unavailable.')} /></div>
              {wordBookmark(game.answer!, game.answerDefinition ?? '')}
            </div>}
            </aside>}

            </div>
          </div>
        )}
      {!game && message && <p className="notice" role="status">{t(message)}</p>}
      {finished && <div className="next-game"><button className="primary-button" onClick={() => void startPractice(true)} disabled={busy || progressSaving || accountLoading || walletOwner !== (account?.id ?? 'guest')}>{t('Play again')}</button><button className="quiet-button" onClick={exitGame} disabled={busy || progressSaving}>{t('Change settings')}</button>{!account && !accountLoading && !accountError && game?.status !== 'cancelled' && <p className="guest-save-reminder"><a href={sectionPaths.account} onClick={event => { event.preventDefault(); navigateTo('account'); }}>{t('Sign in to save your game history.')}</a></p>}</div>}
      </section>
      </>}
      <Suspense fallback={<section className="page-loading" aria-busy="true" />}>
      {activeSection === 'library' && <section className="library-page">
        <VocabularyLibrary onUseCollection={useCollection} key={accountRevision} signedIn={!!account} searchQuery="" onSignIn={() => navigateTo('account')} />
      </section>}
      {activeSection === 'dictionary' && <DictionaryPage key={accountRevision} signedIn={!!account} accountLoading={accountLoading} searchQuery={quickSearch} />}
      {activeSection === 'feedback' && <FeedbackPage />}
      {activeSection === 'home' && <HomePage onNavigate={navigateTo} />}
      {activeSection === 'account' && <AccountPage account={account} setAccount={setAccount} loading={accountLoading} accountError={accountError} onRetry={retryAccount} onSignedIn={signedIn} progressSaving={progressSaving} progressError={progressError} progressMessage={progressMessage} onRetryProgress={retryProgress} />}
      {activeSection === 'progress' && <StatisticsPanel key={accountRevision} onPlay={() => navigateTo('play')} onSignIn={() => navigateTo('account')} />}
      {activeSection === 'community' && <CommunityPage onExplore={() => navigateTo('library')} />}
      {activeSection === 'settings' && <SettingsPage theme={theme} onThemeChange={setTheme} soundEnabled={soundEnabled} onSoundChange={enabled => { gameAudio.setEnabled(enabled); setSoundEnabled(enabled); }} fontSize={interfacePreferences.fontSize} onFontSizeChange={interfacePreferences.setFontSize} language={interfacePreferences.languagePreference} onLanguageChange={interfacePreferences.setLanguage} />}
      {activeSection === 'licenses' && <section className="licenses-page" aria-label={t('Licenses and attribution')}>
        <p className="eyebrow">{t('SOURCES & ATTRIBUTION')}</p><h2>{t('Words with a shared history.')}</h2><p>{t('Our dictionary combines Simple English Wiktionary with supplementary definitions from Open English WordNet.')}</p>
        <article><h3>{t('Dictionary definitions')}</h3><p>{t('Definitions are adapted from ')}<a href="https://simple.wiktionary.org/" target="_blank" rel="noreferrer">{t('Simple English Wiktionary')}</a>{t(', under the ')}<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noreferrer">{t('Creative Commons Attribution-ShareAlike 3.0 license')}</a>{t(', as described in the project’s ')}<a href="https://simple.wiktionary.org/wiki/Wiktionary:Rules" target="_blank" rel="noreferrer">{t('rules')}</a>{t(' and ')}<a href="https://simple.wiktionary.org/wiki/Wiktionary:Copyrights" target="_blank" rel="noreferrer">{t('copyright notice')}</a>.</p>
          <p>{t('LexiPlay removes markup, normalizes spacing, and shortens definitions to the first two senses. Community definitions may vary in accuracy.')}</p>
          <p>{t('Use ')}<a href="https://simple.wiktionary.org/wiki/Special:Search" target="_blank" rel="noreferrer">{t('Wiktionary’s entry search')}</a>{t(' to find an original word page and its contributors in the revision history. Shared adaptations remain subject to the applicable attribution and ShareAlike terms.')}</p>
        </article>
        <article><h3>{t('Open English WordNet 2025')}</h3><p>{t('Supplementary definitions come from ')}<a href="https://github.com/globalwordnet/english-wordnet" target="_blank" rel="noreferrer">{t('Open English WordNet 2025 Core')}</a>{t(', developed by the Open English WordNet team and derived from the Princeton University WordNet database.')}</p><p>{t('The supplement is licensed under ')}<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">{t('Creative Commons Attribution 4.0')}</a>{t(', with the underlying Princeton WordNet notice retained. LexiPlay normalizes whitespace and groups word classes, preserves existing useful definitions, and selects up to two WordNet meanings per word class for display. Full imported meanings and source identifiers remain in the database.')}</p><p><a href="/licenses/open-english-wordnet-LICENSE.md" target="_blank" rel="noreferrer">{t('Open English WordNet license notice')}</a> · <a href="/licenses/Princeton-WordNet-LICENSE.txt" target="_blank" rel="noreferrer">{t('Princeton WordNet license notice')}</a></p></article>
        <article><h3>{t('C2 vocabulary selection')}</h3><p>{t('The expanded C2 selection adapts the ')}<a href="https://github.com/openlanguageprofiles/olp-en-cefrj" target="_blank" rel="noreferrer">{t('Octanove Vocabulary Profile C1/C2 v1.0')}</a>{t(', created by Octanove Labs and published through Open Language Profiles under ')}<a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">{t('CC BY-SA 4.0')}</a>{t('. LexiPlay normalizes spelling alternatives, removes duplicate entries, and admits additions only with a published family match and a matching dictionary definition. Entries requiring review of a particular meaning are held back. The original starter used ')}<a href="https://www.esl-lounge.com/student/reference/c2-cefr-vocabulary-word-list.php" target="_blank" rel="noreferrer">{t('ESL Lounge')}</a>{t(' as one reference.')}</p><p>{t('This is a learning selection, not an official or exhaustive CEFR inventory. Dictionary definitions retain their own source licences. ')}<a href="/data/lexiplay-c2.json" target="_blank" rel="noreferrer">{t('Download the adapted C2 selection')}</a> · <a href="/licenses/cefr-data-NOTICE.md" target="_blank" rel="noreferrer">{t('Data attribution and modifications')}</a></p></article>
        <article><h3>{t('Word-family grouping')}</h3><p>{t('Family identities are adapted from Paul Nation\'s BNC/COCA word-family lists v1.0.0, hosted by ')}<a href="https://www.wgtn.ac.nz/lals/resources/paul-nations-resources" target="_blank" rel="noreferrer">{t('Victoria University of Wellington')}</a>{t('. The adapted mapping is provided under CC BY-SA 4.0, following the university\'s resource licence statement. Grouping does not assign one CEFR level or shared learning progress to every member. Phrases and entries without a published match remain separate study items. ')}<a href="/data/bnc-coca-families.json" target="_blank" rel="noreferrer">{t('Download the adapted family mapping')}</a></p></article>
        <article><h3>{t('Original Wordle answers')}</h3><p>{t('The five-letter answer pool uses the original 2,315-word selection by Josh Wardle, preserved in ')}<a href="https://gist.github.com/cfreshman/a03ef2cba789d8cf00c08f767e0fad7b" target="_blank" rel="noreferrer">{t('cfreshman’s source extraction')}</a>{t('. Playable answers have matching English definitions in the LexiPlay dictionary. This selection does not track subsequent New York Times editorial changes.')}</p></article>
      </section>}
      </Suspense>
      <footer className="workspace-footer"><div className="footer-links"><a href="https://github.com/Hwent" target="_blank" rel="noopener noreferrer" aria-label={t('Visit Hwent on GitHub (opens in a new tab)')}>{t('Hwent on GitHub ')}<Icon name="arrow" /></a><a href="/licenses" onClick={event => { event.preventDefault(); navigateTo('licenses'); }} aria-current={activeSection === 'licenses' ? 'page' : undefined}>{t('Licenses')}</a></div></footer>
      </div>
    </main></PendingWordsContext.Provider></LanguageContext.Provider>
  );
}
