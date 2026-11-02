import { createBrowserRouter, Navigate, Route, Routes, useBlocker, useLocation, useNavigate } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import GamePage from './GamePage';
import LicensesPage from './LicensesPage';
import type { Game, Feedback, GuessResult, HintType } from './game-types';
import { sectionPaths, type Section } from './routes';
import { PendingWords } from './services/pending-words';
import { PendingWordsContext, useWordSelection } from './usePendingWords';
import Icon, { IconName } from './Icon';
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import AccountStatus from './AccountStatus';
import useAccount from './useAccount';
import HomePage from './HomePage';
import PronunciationButton from './PronunciationButton';
import { normalizeTerm, rememberDictionaryDefinition, clearDictionaryCache } from './dictionary-cache';
import { ApiError, apiRequest as api } from './services/api-client';
import { hasPracticePreferences, readPracticePreferences, savePracticePreferences } from './practice-preferences';
import GuestGameReminder from './GuestGameReminder';
import AnimalGameInvitation, { hasSeenAnimalInvitation } from './AnimalGameInvitation';
import { definitionHintText } from './hint-text';
import { gameAudio } from './services/game-audio';
import { GameOptions, GAME_OPTIONS_PATH, GAME_OPTIONS_LIFETIME } from './services/game-options';
import { createTranslator, LanguageContext } from './i18n';
import { useInterfacePreferences } from './interface-preferences';
import { PersonalList, PersonalPage, VocabularyCollection } from './collection-types';

import VocabularyLibrary from './VocabularyLibrary';
import DictionaryPage from './DictionaryPage';
import FeedbackPage from './FeedbackPage';
import AccountPage from './AccountPage';
import SettingsPage from './SettingsPage';
import CommunityPage from './CommunityPage';
import StatisticsPanel, { statisticsPath } from './StatisticsPanel';
import AnimalGuessGame from './animal-guess/AnimalGuessGame';
import { syncAnimalPractice } from './animal-guess/practice-progress';

type Theme = 'dark' | 'light';
const LAST_GAME_KEY = 'lexiplay-last-game';

function BookmarkIcon({ added }: { added: boolean }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 3.75h12a1 1 0 0 1 1 1v16l-7-4.5-7 4.5v-16a1 1 0 0 1 1-1Z" fill={added ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>;
}

function savedDefinition(text: string) {
  const trimmed = text.trim();
  return trimmed.length > 500 ? `${trimmed.slice(0, 499).trimEnd()}…` : trimmed;
}

const feedbackRank: Record<Feedback, number> = { ABSENT: 1, PRESENT: 2, CORRECT: 3 };

export default function App() {
  const [router, setRouter] = useState<ReturnType<typeof createBrowserRouter> | null>(null);
  useEffect(() => {
    const instance = createBrowserRouter([{ path: '*', element: <AppLayout /> }]);
    setRouter(instance);
    return () => instance.dispose();
  }, []);
  return router ? <RouterProvider router={router} /> : null;
}

function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const action = new URLSearchParams(location.hash.slice(1)).get('action');
  const activeSection: Section = action === 'reset' || action === 'verify' ? 'account'
    : (Object.entries(sectionPaths).find(([, path]) => path === location.pathname)?.[0] as Section | undefined)
      ?? (location.pathname === '/play' ? 'play' : 'home');
  const interfacePreferences = useInterfacePreferences();
  const t = useMemo(() => createTranslator(interfacePreferences.language), [interfacePreferences.language]);
  const [preferences] = useState(readPracticePreferences);
  const firstGuestVisit = useRef(!hasPracticePreferences());
  const { account, setAccount, loading: accountLoading, error: accountError, retry: retryAccount, signedIn, progressSaving, progressError, progressMessage, retryProgress } = useAccount();
  const [game, setGame] = useState<Game | null>(null);
  const [dismissedGuestReminder, setDismissedGuestReminder] = useState('');
  const [animalInvitationPending, setAnimalInvitationPending] = useState(() => !hasSeenAnimalInvitation());
  const [accountEntryMode, setAccountEntryMode] = useState<'login' | 'register'>('login');
  const playAgainRef = useRef<HTMLButtonElement>(null);
  const [wallet, setWallet] = useState<{ coinBalance: number; kind: string } | null>(null);
  const [walletOwner, setWalletOwner] = useState<string | null>(null);
  const startRequest = useRef<{ key: string; id: string } | null>(null);
  const [guess, setGuess] = useState('');
  const [gameInputFocused, setGameInputFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [rejectedAttempt, setRejectedAttempt] = useState(0);
  const [revealingGuess, setRevealingGuess] = useState<{ gameId: string; row: number } | null>(null);
  const [celebrationId, setCelebrationId] = useState('');
  const [selectedWordLength, setSelectedWordLength] = useState(preferences.wordLength);
  const [puzzleKind, setPuzzleKind] = useState<'word-puzzle' | 'word-ladder'>('word-puzzle');
  const [ladderWordLength, setLadderWordLength] = useState(5);
  useEffect(() => { if (game) setPuzzleKind(game.ladder ? 'word-ladder' : 'word-puzzle'); }, [game?.id]);
  const [restoring, setRestoring] = useState(false);
  const [accountRevision, setAccountRevision] = useState(0);
  useEffect(() => {
    if (accountLoading || progressSaving || accountError) return;
    const sync = () => { void syncAnimalPractice(account?.id ?? 'guest'); };
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('focus', sync);
    return () => { window.removeEventListener('online', sync); window.removeEventListener('focus', sync); };
  }, [account?.id, accountLoading, accountError, progressSaving]);
  const [selectedPoolId, setSelectedPoolId] = useState(preferences.collectionId);
  const wordStore = useMemo(() => new PendingWords(account?.id ?? 'guest'), [account?.id]);
  const wordSelection = useWordSelection(wordStore);
  const [theme, setTheme] = useState<Theme>(() => {
    try { return localStorage.getItem('lexiplay-theme') === 'light' ? 'light' : 'dark'; }
    catch { return 'dark'; }
  });
  const [soundEnabled, setSoundEnabled] = useState(() => gameAudio.enabled);
  useEffect(() => gameAudio.listen(), []);
  const [quickSearch, setQuickSearch] = useState('');
  useEffect(() => {
    if (accountLoading) return;
    void wordStore.requests.get<GameOptions[]>(GAME_OPTIONS_PATH, GAME_OPTIONS_LIFETIME).catch(() => {});
    void wordStore.requests.get<VocabularyCollection[]>('/collections', 300_000).catch(() => {});
    if (wordStore.owner === 'guest') return;
    void wordStore.loadSaved().catch(() => {});
    void wordStore.requests.get<PersonalList[]>('/word-lists/mine').then(lists => {
      const list = lists.find(item => item.isDefault) ?? lists[0];
      if (!list) return;
      const params = new URLSearchParams({ page: '1', pageSize: '25', language: list.preferredLanguage });
      return wordStore.requests.get<PersonalPage>(`/word-lists/${list.id}/entries?${params}`);
    }).catch(() => {});
  }, [accountLoading, accountRevision, wordStore]);
  useEffect(() => {
    if (!accountLoading && account) firstGuestVisit.current = false;
    if (accountLoading || account || accountError || !firstGuestVisit.current) return;
    let active = true;
    void wordStore.requests.get<VocabularyCollection[]>('/collections', 300_000).then(collections => {
      if (!active || !firstGuestVisit.current) return;
      const a2 = collections.find(collection => collection.level === 'A2' && collection.status === 'available');
      if (a2) { firstGuestVisit.current = false; setSelectedPoolId(a2.slug); }
    }).catch(() => {});
    return () => { active = false; };
  }, [accountLoading, account, accountError, wordStore]);
  useEffect(() => {
    savePracticePreferences({ wordLength: selectedWordLength, collectionId: selectedPoolId });
  }, [selectedWordLength, selectedPoolId]);
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
  useEffect(() => {
    if (!accountLoading && (activeSection === 'play' || activeSection === 'animal-guess' || activeSection === 'library')) void wordStore.loadSaved().catch(() => {});
  }, [accountLoading, activeSection, wordStore]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    currentLocation.pathname !== nextLocation.pathname && (wordSelection.pending.size > 0 || wordSelection.saving));
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    void wordStore.flush().then(() => blocker.proceed()).catch(() => blocker.reset());
  }, [blocker, wordStore]);
  useEffect(() => {
    window.dispatchEvent(new Event('lexiplay:before-route-change'));
    setQuickSearch('');
  }, [location.pathname]);
  useEffect(() => {
    const leaving = () => { void wordStore.flush(true).catch(() => {}); };
    window.addEventListener('pagehide', leaving);
    return () => window.removeEventListener('pagehide', leaving);
  }, [wordStore]);

  function prefetchSection(section: Section) {
    if (accountLoading) return;
    if (section === 'progress' && account) void wordStore.requests.get(statisticsPath(), 30_000).catch(() => {});
    if (section === 'community') void wordStore.requests.get('/community/practice-rankings', 30_000).catch(() => {});
    if (section === 'library') void wordStore.requests.get('/collections', 300_000).catch(() => {});
    if (section === 'play') void wordStore.requests.get(GAME_OPTIONS_PATH, GAME_OPTIONS_LIFETIME).catch(() => {});
  }

  function navigateTo(section: Section, search?: string, accountMode: 'login' | 'register' = 'login') {
    if (section === 'account') setAccountEntryMode(accountMode);
    navigate(sectionPaths[section], { state: { search: search ?? '' } });
    setQuickSearch(search ?? '');
  }

  async function exitGame() {
    if (busy || (game && !finished && game.guesses.length > 0)) return;
    setBusy(true);
    try {
      await wordStore.flush();
      if (game && !finished) await api(`/games/${game.id}/abandon`, { method: 'POST' });
      resetGame();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not leave your puzzle. Try again.'); }
    finally { setBusy(false); }
  }
  async function giveUp() {
    if (!game || finished || busy || progressSaving) return;
    const session = guessSession.current;
    setBusy(true);
    try {
      await wordStore.flush();
      const result = await api<Game>(`/games/${game.id}/give-up`, { method: 'POST' });
      if (session !== guessSession.current) return;
      guessSession.current++;
      setGame(result); setGuess(''); setRejectedAttempt(0);
      setMessage(result.status === 'lost' ? 'You gave up. The entry coin was not returned.' : '');
      wordStore.requests.invalidate('/progress/');
      if (activeSectionRef.current === 'play') gameAudio.play('complete');
    } catch (error) { if (session === guessSession.current) setMessage(error instanceof Error ? error.message : 'Could not give up. Try again.'); }
    finally { setBusy(false); }
  }
  async function useCollection(poolId:string) {
    if (busy) return;
    setBusy(true);
    try {
      await wordStore.flush();
      if (game && !finished) await api(`/games/${game.id}/abandon`, { method: 'POST' });
      resetGame(); setSelectedPoolId(poolId); navigateTo('play');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not change your puzzle. Try again.');
      if (error instanceof ApiError && error.code === 'PUZZLE_ALREADY_STARTED') navigateTo('play');
    }
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

  function selectPuzzle(kind: 'word-puzzle' | 'word-ladder') {
    if (game && finished) resetGame();
    setPuzzleKind(kind); setMessage(''); navigateTo('play');
  }

  useEffect(() => {
    let active = true;
    let id: string | null = null;
    try { id = window.localStorage.getItem(LAST_GAME_KEY); } catch { /* Resume is optional when storage is unavailable. */ }
    if (id) {
      setRestoring(true);
      api<Game>(`/games/${encodeURIComponent(id)}`).then(result => { if (active) setGame(result); }).catch(error => {
        if (!active) return;
        if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
          try { if (window.localStorage.getItem(LAST_GAME_KEY) === id) window.localStorage.removeItem(LAST_GAME_KEY); } catch { /* Storage may be unavailable. */ }
        }
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
  const setupReward = puzzleKind === 'word-ladder' ? ladderWordLength : Math.ceil(selectedWordLength / 2) + 2;
  const showGuestReminder = !!(activeSection === 'play' && game && finished && game.status !== 'cancelled' && !account && !accountLoading && !accountError && dismissedGuestReminder !== game.id);
  const showAnimalInvitation = animalInvitationPending && !accountLoading && !restoring && !showGuestReminder;

  useEffect(() => {
    if (accountLoading || progressSaving) return;
    let active = true;
    api<{coinBalance:number;kind:string;activeGameId?:string|null}>('/games/wallet').then(async value => {
      if (!active || !Number.isInteger(value.coinBalance)) return;
      setWallet(value);
      if (value.activeGameId && value.activeGameId !== game?.id) {
        setRestoring(true);
        try {
          const restored = await api<Game>(`/games/${encodeURIComponent(value.activeGameId)}`);
          if (active) {
            guessSession.current++;
            setGuess(''); setMessage(''); setRejectedAttempt(0);
            try { localStorage.setItem(LAST_GAME_KEY, restored.id); } catch { /* The server can recover this game again. */ }
            setGame(restored);
          }
        } catch (error) {
          if (active) {
            if (!account && error instanceof ApiError && [401, 403, 404].includes(error.status)) resetGame();
            else setMessage('Could not restore your puzzle. Reload to try again.');
          }
        }
        finally { if (active) setRestoring(false); }
      }
    }).catch(() => { if (active) setWallet(null); }).finally(() => {
      if (active) setWalletOwner(account?.id ?? 'guest');
    });
    return () => { active = false; };
  }, [account?.id, accountLoading, progressSaving, game?.id, game?.guesses.length, game?.hintCoinsSpent]);

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
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f5f6f3' : '#141a14');
    try { localStorage.setItem('lexiplay-theme', theme); } catch { /* Keep the selection for this visit. */ }
  }, [theme]);

  async function startPractice(replay = false) {
    if (progressSaving || accountLoading || walletOwner !== (account?.id ?? 'guest')) return;
    setBusy(true);
    setMessage('');
    try {
      await wordStore.flush();
      const options = (replay && game ? !!game.ladder : puzzleKind === 'word-ladder')
        ? { kind: 'word-ladder', wordLength: replay && game ? game.wordLength : ladderWordLength }
        : { kind: 'word-puzzle', wordLength: replay && game ? game.wordLength : selectedWordLength,
        difficulty: 'medium', playWithMyWords: false,
        ...(selectedPoolId ? { collectionId: selectedPoolId } : {}) };
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
      setGame({ ...newGame, hints: newGame.hints ?? { definition: 1 }, revealedAbsent: newGame.revealedAbsent ?? [], revealedPresent: newGame.revealedPresent ?? [] });
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
    if (!game || busy || submittingGuess.current || progressSaving || finished) return;
    const session = guessSession.current;
    setBusy(true);
    setMessage('');
    setRejectedAttempt(0);
    if (type === 'nextWord') submittingGuess.current = true;
    try {
      const result = await api<{ type: HintType; text: string; hints: Game['hints']; cost: number }>(`/games/${game.id}/hints`, {
        method: 'POST', body: JSON.stringify({ type }),
      });
      if (session !== guessSession.current) return;
      const updatedGame = { ...game, hints: result.hints, clues: { ...game.clues, [type]: result.text }, hintCoinsSpent: (game.hintCoinsSpent ?? 0) + result.cost };
      setGame(updatedGame);
      if (activeSectionRef.current === 'play') gameAudio.play('hint');
      setMessage('');
      if (type === 'nextWord') {
        setGuess(result.text);
        await checkGuess(updatedGame, result.text, session);
        inputRef.current?.focus({ preventScroll: true });
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not use this hint.');
    } finally {
      submittingGuess.current = false;
      setBusy(false);
    }
  }

  function hintPanel(type: HintType) {
    if (!game || finished) return null;
    const title = type === 'nextWord' ? 'Auto-fill a word' : 'Definition';
    const clue = game.clues?.[type];
    const revealed = !!clue && type === 'definition';
    return <aside className={`puzzle-hint hint-${type}`} aria-label={t('{0} hint', t(title))}>
      <button className="friendly-hint" type="button" aria-label={t('{0} hint · {1}', t(title), (clue ? t(revealed ? 'Revealed' : 'Fill word') : t('1 coin')))} onClick={() => void useHint(type)} disabled={busy || progressSaving || revealed || (!clue && game.hints[type] === 0)}>
        <span className="hint-icon" aria-hidden="true"><Icon name="library"/></span><strong>{t(title)}</strong><span className="hint-price">{clue ? <Icon name="check"/> : <><Icon name="coin"/>1</>}</span>
      </button>
      {revealed && <p className="hint-clue">{definitionHintText(clue)}</p>}
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
    setBusy(true);
    setMessage('');
    try { await checkGuess(game, nextGuess, guessSession.current); }
    finally { submittingGuess.current = false; setBusy(false); }
  }

  async function checkGuess(game: Game, nextGuess: string, session: number) {
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
      const clues = { ...game.clues };
      if (game.ladder) delete clues.nextWord;
      setGame({ ...game, clues, ...(game.ladder ? { hints: { definition: 0, nextWord: result.completed ? 0 : 1 } } : {}), guesses: [...game.guesses, result], attemptCount: game.guesses.length + 1, completed: result.completed,
        ...(result.completed ? { status: result.outcome === 'WON' ? 'won' : 'lost', answer: result.answer, answerDefinition: result.answerDefinition } : {}) });
      setGuess('');
      setRejectedAttempt(0);
      if (result.completed) {
        wordStore.requests.invalidate('/progress/');
        if (result.outcome === 'WON') setCelebrationId(game.id);
        setMessage(result.outcome === 'WON'
          ? result.rewardCoins ? `${game.ladder ? 'Four new words!' : 'You found it!'} ${result.rewardCoins} coins earned${game.coinPayer === 'guest' && account ? ' in your guest wallet' : ''}.` : 'You found it! A new word is ready whenever you are.'
          : `Practice complete. The answer was ${result.answer}.`);
      }
    } catch (error) {
      if (session !== guessSession.current) return;
      if (error instanceof ApiError && (error.code === 'INVALID_LADDER_STEP' || error.code === 'REPEATED_LADDER_WORD')) {
        setRejectedAttempt(value => value + 1);
        if (activeSectionRef.current === 'play') gameAudio.play('invalid');
        setMessage(error.message);
      } else if (error instanceof ApiError && error.status === 400 && (error.code === 'INVALID_GUESS' || (!error.code && /valid.*word|dictionary/i.test(error.message)))) {
        setRejectedAttempt(value => value + 1);
        if (activeSectionRef.current === 'play') gameAudio.play('invalid');
        setMessage(`${nextGuess.toUpperCase()} is not in the dictionary. Try another word.`);
      } else setMessage(error instanceof Error ? error.message : 'Could not submit your guess. Press Enter to retry.');
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
  for (const result of game?.ladder ? [] : game?.guesses ?? []) {
    result.guess.split('').forEach((letter, index) => {
      const key = letter.toUpperCase();
      const feedback = result.feedback[index]!;
      const previous = keyboardFeedback.get(key);
      if (!previous || feedbackRank[feedback] > feedbackRank[previous]) keyboardFeedback.set(key, feedback);
    });
  }

  const sectionTitle: Record<Section, string> = {
    home: t('Home'), play: t('Games'), library: t('Words'), dictionary: t('Dictionary'),
    'animal-guess': t('Guess Animal'),
    progress: t('Stats'), community: t('Community'), settings: t('Settings'), licenses: t('Licenses'), account: t('Account'), feedback: t('Feedback'),
  };
  const navigation: { key: Section; icon: IconName }[] = [
    { key: 'play', icon: 'play' }, { key: 'library', icon: 'library' },
    { key: 'dictionary', icon: 'dictionary' },
    { key: 'progress', icon: 'progress' }, { key: 'settings', icon: 'settings' },
  ];
  const statsSections = [{ key: 'progress', label: 'Overview' }, { key: 'community', label: 'Community' }] as const;
  const settingsSections = [{ key: 'settings', label: 'Preferences' }, { key: 'account', label: 'Account' }, { key: 'feedback', label: 'Feedback' }] as const;
  const activeNavigationSection = activeSection === 'animal-guess' ? 'play' : activeSection === 'community' ? 'progress' : activeSection === 'feedback' || activeSection === 'account' ? 'settings' : activeSection;
  const sectionNavigation = activeNavigationSection === 'progress' ? statsSections : activeNavigationSection === 'settings' ? settingsSections : null;

  return (
    <LanguageContext.Provider value={interfacePreferences.language}><PendingWordsContext.Provider value={wordStore}><main className="app-shell" inert={showGuestReminder || showAnimalInvitation}>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label={t('LexiPlay home')} onClick={event => { event.preventDefault(); navigateTo('home'); }}><span className="brand-mark">L</span>{t(' LexiPlay')}</a>
        <nav aria-label={t('Main navigation')} className="main-navigation">
          {navigation.map(item => <button type="button" key={item.key} aria-label={sectionTitle[item.key]} className={activeNavigationSection === item.key ? 'active' : ''} aria-current={activeNavigationSection === item.key ? 'page' : undefined} onPointerEnter={() => prefetchSection(item.key)} onFocus={() => prefetchSection(item.key)} onClick={() => navigateTo(item.key)}><span className="nav-icon" aria-hidden="true"><Icon name={item.icon}/></span><span className="nav-label">{sectionTitle[item.key]}</span><span className="nav-mobile-label" aria-hidden="true">{sectionTitle[item.key]}</span></button>)}
        </nav>
      </aside>
      <div className="workspace">
      <header className="topbar">
        <h1 className="sr-only">{sectionTitle[activeNavigationSection]}</h1>
        <div className="header-actions">
          <form className="header-search" role="search" onSubmit={event => { event.preventDefault(); navigateTo('dictionary', quickSearch); }}>
            <label className="sr-only" htmlFor="quick-search">{t('Quick dictionary search')}</label>
            <input ref={searchRef} id="quick-search" type="search" value={quickSearch} onChange={event => setQuickSearch(event.target.value)} placeholder={t('Search the dictionary')} aria-keyshortcuts="/" onKeyDown={event => { if (event.key === 'Escape') event.currentTarget.blur(); }} />
            <kbd aria-hidden="true">/</kbd>
            <button type="submit" aria-label={t('Search dictionary')}><Icon name="search"/></button>
          </form>
          <AccountStatus coinBalance={walletOwner === (account?.id ?? 'guest') ? wallet?.coinBalance : account?.coinBalance} account={account} loading={accountLoading} error={accountError} onOpen={() => navigateTo('account')} />
          <a className="header-home" href="/" aria-label={t('Home')} title={t('Home')} onClick={event => { event.preventDefault(); navigateTo('home'); }}><span className="brand-mark" aria-hidden="true">L</span></a>
        </div>
      </header>
      {wordSelection.error && <p className="word-selection-error" role="alert">{t(wordSelection.error)}</p>}
      {wordSelection.notice && <p className="word-selection-error" role="alert">{t(wordSelection.notice)}</p>}
      {sectionNavigation && <nav className="section-navigation" aria-label={activeNavigationSection === 'progress' ? t('Stats sections') : t('Settings sections')}>
        {sectionNavigation.map(item => <a key={item.key} href={sectionPaths[item.key]} onPointerEnter={() => prefetchSection(item.key)} onFocus={() => prefetchSection(item.key)} aria-current={activeSection === item.key ? 'page' : undefined} onClick={event => { event.preventDefault(); navigateTo(item.key); }}>{t(item.label)}</a>)}
      </nav>}

      {(activeSection === 'play' || activeSection === 'animal-guess') && <>
      {!game && <div className="page-introduction"><div><h2>{t('Choose your ')}<span>{t('challenge.')}</span></h2></div><span className="page-intro-icon" aria-hidden="true"><Icon name="play" /></span></div>}
      <div className="puzzle-type-options" role="group" aria-label={t('Puzzle type')}>
        <button type="button" aria-pressed={activeSection === 'play' && puzzleKind === 'word-puzzle'} onClick={() => selectPuzzle('word-puzzle')} disabled={busy || restoring || (!!game && !finished && puzzleKind !== 'word-puzzle')}>{t('Word puzzle')}</button>
        <button type="button" aria-pressed={activeSection === 'play' && puzzleKind === 'word-ladder'} onClick={() => selectPuzzle('word-ladder')} disabled={busy || restoring || (!!game && !finished && puzzleKind !== 'word-ladder')}>{t('Word Ladder')}</button>
        <button type="button" aria-pressed={activeSection === 'animal-guess'} onClick={() => navigateTo('animal-guess')}>{t('Guess Animal')}</button>
      </div>
      </>}
      <Routes location={action === 'reset' || action === 'verify' ? { ...location, pathname: '/account' } : location}>
      <Route path="/games/animal-guess" element={<AnimalGuessGame bookmark={wordBookmark} practiceOwner={accountLoading || progressSaving || accountError ? null : account?.id ?? 'guest'}/>} />
      <Route path="/games" element={<GamePage
        game={game}
        busy={busy}
        progressSaving={progressSaving}
        restoring={restoring}
        puzzleKind={puzzleKind}
        ladderWordLength={ladderWordLength}
        selectedWordLength={selectedWordLength}
        selectedPoolId={selectedPoolId}
        firstGuestVisit={firstGuestVisit}
        setupReward={setupReward}
        accountLoading={accountLoading}
        walletOwner={walletOwner}
        account={account}
        puzzleRef={puzzleRef}
        celebrationId={celebrationId}
        finished={finished}
        attemptsRemaining={attemptsRemaining}
        message={message}
        rejectedAttempt={rejectedAttempt}
        gameInputFocused={gameInputFocused}
        submittingGuess={submittingGuess}
        guess={guess}
        revealingGuess={revealingGuess}
        playAgainRef={playAgainRef}
        accountError={accountError}
        inputRef={inputRef}
        keyboardFeedback={keyboardFeedback}
        focusGameInput={focusGameInput}
        setLadderWordLength={setLadderWordLength}
        setSelectedWordLength={setSelectedWordLength}
        setSelectedPoolId={setSelectedPoolId}
        startPractice={startPractice}
        exitGame={exitGame}
        giveUp={giveUp}
        setRevealingGuess={setRevealingGuess}
        navigateTo={navigateTo}
        setGameInputFocused={setGameInputFocused}
        changeGuess={changeGuess}
        handleInputKeyDown={handleInputKeyDown}
        hintPanel={hintPanel}
        submitGuess={submitGuess}
        addLetter={addLetter}
        deleteLetter={deleteLetter}
        wordBookmark={wordBookmark}
        />}
        />
      <Route path="/library" element={<section className="library-page">
        <VocabularyLibrary onUseCollection={useCollection} key={accountRevision} signedIn={!!account} searchQuery="" onSignIn={() => navigateTo('account')} />
      </section>} />
      <Route path="/dictionary" element={<DictionaryPage key={accountRevision} signedIn={!!account} accountLoading={accountLoading} searchQuery={(location.state as { search?: string } | null)?.search ?? ''} />} />
      <Route path="/feedback" element={<FeedbackPage />} />
      <Route path="/" element={<HomePage onNavigate={navigateTo} />} />
      <Route path="/account" element={<AccountPage account={account} setAccount={setAccount} loading={accountLoading} accountError={accountError} onRetry={retryAccount} onSignedIn={signedIn} progressSaving={progressSaving} progressError={progressError} progressMessage={progressMessage} onRetryProgress={retryProgress} initialMode={accountEntryMode} />} />
      <Route path="/progress" element={<StatisticsPanel key={accountRevision} onPlay={() => navigateTo('play')} onSignIn={() => navigateTo('account')} />} />
      <Route path="/community" element={<CommunityPage onExplore={() => navigateTo('library')} />} />
      <Route path="/settings" element={<SettingsPage theme={theme} onThemeChange={setTheme} soundEnabled={soundEnabled} onSoundChange={enabled => { gameAudio.setEnabled(enabled); setSoundEnabled(enabled); }} fontSize={interfacePreferences.fontSize} onFontSizeChange={interfacePreferences.setFontSize} language={interfacePreferences.languagePreference} onLanguageChange={interfacePreferences.setLanguage} />} />
      <Route path="/licenses" element={<LicensesPage />} />
      <Route path="/play" element={<Navigate to="/games" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <footer className="workspace-footer"><div className="footer-links"><a href="https://github.com/Hwent" target="_blank" rel="noopener noreferrer" aria-label={t('Visit Hwent on GitHub (opens in a new tab)')}>{t('Hwent on GitHub ')}<Icon name="arrow" /></a><a href="/licenses" onClick={event => { event.preventDefault(); navigateTo('licenses'); }} aria-current={activeSection === 'licenses' ? 'page' : undefined}>{t('Licenses')}</a></div></footer>
      </div>
    </main>
    {showGuestReminder && game && <GuestGameReminder key={game.id} returnFocusRef={playAgainRef} onDismiss={() => setDismissedGuestReminder(game.id)} onSignIn={() => { setDismissedGuestReminder(game.id); navigateTo('account'); }} onCreateAccount={() => { setDismissedGuestReminder(game.id); navigateTo('account', undefined, 'register'); }}/>}
    {showAnimalInvitation && <AnimalGameInvitation onDismiss={() => setAnimalInvitationPending(false)} onPlay={() => { setAnimalInvitationPending(false); navigateTo('animal-guess'); }}/>}
    </PendingWordsContext.Provider></LanguageContext.Provider>
  );
}
