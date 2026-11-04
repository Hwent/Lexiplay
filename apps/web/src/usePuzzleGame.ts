import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Account } from './useAccount';
import type { Game, GameWallet, Feedback, GuessResult, HintType } from './game-types';
import type { Section } from './routes';
import type { PendingWords } from './services/pending-words';
import { ApiError, apiRequest as api } from './services/api-client';
import {
  hasPracticePreferences,
  readPracticePreferences,
  savePracticePreferences,
} from './practice-preferences';
import {
  rememberDictionaryDefinition,
  clearDictionaryCache,
} from './dictionary-cache';
import { gameAudio } from './services/game-audio';
import type { VocabularyCollection } from './collection-types';

const LAST_GAME_KEY = 'lexiplay-last-game';
const feedbackRank: Record<Feedback, number> = {
  ABSENT: 1,
  PRESENT: 2,
  CORRECT: 3,
};

type Options = {
  account: Account | null;
  accountLoading: boolean;
  accountError: string;
  progressSaving: boolean;
  activeSection: Section;
  wordStore: PendingWords;
  navigateTo: (section: Section) => void;
  onDataChange: () => void;
};

// Mounted by the layout so a round survives navigation between pages.
export default function usePuzzleGame({
  account,
  accountLoading,
  accountError,
  progressSaving,
  activeSection,
  wordStore,
  navigateTo,
  onDataChange,
}: Options) {
  const [preferences] = useState(readPracticePreferences);
  const firstGuestVisit = useRef(!hasPracticePreferences());
  const [game, setGame] = useState<Game | null>(null);
  const playAgainRef = useRef<HTMLButtonElement>(null);
  const [wallet, setWallet] = useState<{
    coinBalance: number;
    kind: string;
  } | null>(null);
  const [walletOwner, setWalletOwner] = useState<string | null>(null);
  const startRequest = useRef<{ key: string; id: string } | null>(null);
  const [guess, setGuess] = useState('');
  const [gameInputFocused, setGameInputFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [rejectedAttempt, setRejectedAttempt] = useState(0);
  const [revealingGuess, setRevealingGuess] = useState<{
    gameId: string;
    row: number;
  } | null>(null);
  const [celebrationId, setCelebrationId] = useState('');
  const [selectedWordLength, setSelectedWordLength] = useState(
    preferences.wordLength,
  );
  const [puzzleKind, setPuzzleKind] = useState<'word-puzzle' | 'word-ladder'>(
    'word-puzzle',
  );
  const [ladderWordLength, setLadderWordLength] = useState(5);
  useEffect(() => {
    if (game) setPuzzleKind(game.ladder ? 'word-ladder' : 'word-puzzle');
  }, [game?.id]);
  const [restoring, setRestoring] = useState(false);
  const [selectedPoolId, setSelectedPoolId] = useState(
    preferences.collectionId,
  );
  useEffect(() => {
    if (!accountLoading && account) firstGuestVisit.current = false;
    if (accountLoading || account || accountError || !firstGuestVisit.current)
      return;
    let active = true;
    void wordStore.requests
      .get<VocabularyCollection[]>('/collections', 300_000)
      .then((collections) => {
        if (!active || !firstGuestVisit.current) return;
        const a2 = collections.find(
          (collection) =>
            collection.level === 'A2' && collection.status === 'available',
        );
        if (a2) {
          firstGuestVisit.current = false;
          setSelectedPoolId(a2.slug);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [accountLoading, account, accountError, wordStore]);
  useEffect(() => {
    savePracticePreferences({
      wordLength: selectedWordLength,
      collectionId: selectedPoolId,
    });
  }, [selectedWordLength, selectedPoolId]);
  useEffect(() => {
    if (!celebrationId) return;
    if (activeSection !== 'play') {
      setCelebrationId('');
      return;
    }
    const timer = window.setTimeout(() => setCelebrationId(''), 2800);
    return () => window.clearTimeout(timer);
  }, [celebrationId, activeSection]);
  const inputRef = useRef<HTMLInputElement>(null);
  const puzzleRef = useRef<HTMLDivElement>(null);
  const submittingGuess = useRef(false);
  const guessSession = useRef(0);
  const bootstrapWalletUsed = useRef<string | null>(null);
  const gameReads = useRef(new Map<string, Promise<Game>>());
  function readGame(id: string) {
    const pending = gameReads.current.get(id);
    if (pending) return pending;
    const request = api<Game>(`/games/${encodeURIComponent(id)}`).finally(() => {
      if (gameReads.current.get(id) === request) gameReads.current.delete(id);
    });
    gameReads.current.set(id, request);
    return request;
  }

  const activeSectionRef = useRef(activeSection);
  activeSectionRef.current = activeSection;
  async function exitGame() {
    if (busy || (game && !finished && game.guesses.length > 0)) return;
    setBusy(true);
    try {
      await wordStore.flush();
      if (game && !finished)
        await api(`/games/${game.id}/abandon`, { method: 'POST' });
      resetGame();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Could not leave your puzzle. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function giveUp() {
    if (!game || finished || busy || progressSaving) return;
    const session = guessSession.current;
    setBusy(true);
    try {
      await wordStore.flush();
      const result = await api<Game>(`/games/${game.id}/give-up`, {
        method: 'POST',
      });
      if (session !== guessSession.current) return;
      guessSession.current++;
      setGame(result);
      setGuess('');
      setRejectedAttempt(0);
      setMessage(
        result.status === 'lost'
          ? 'You gave up. The entry coin was not returned.'
          : '',
      );
      wordStore.requests.invalidate('/progress/');
      if (activeSectionRef.current === 'play') gameAudio.play('complete');
    } catch (error) {
      if (session === guessSession.current)
        setMessage(
          error instanceof Error
            ? error.message
            : 'Could not give up. Try again.',
        );
    } finally {
      setBusy(false);
    }
  }
  async function selectCollection(poolId: string) {
    if (busy) return;
    setBusy(true);
    try {
      await wordStore.flush();
      if (game && !finished)
        await api(`/games/${game.id}/abandon`, { method: 'POST' });
      resetGame();
      setSelectedPoolId(poolId);
      navigateTo('play');
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Could not change your puzzle. Try again.',
      );
      if (error instanceof ApiError && error.code === 'PUZZLE_ALREADY_STARTED')
        navigateTo('play');
    } finally {
      setBusy(false);
    }
  }

  function resetGame() {
    guessSession.current++;
    try {
      window.localStorage.removeItem(LAST_GAME_KEY);
    } catch {
      /* Storage may be unavailable. */
    }
    setGame(null);
    setGuess('');
    setMessage('');
    setRejectedAttempt(0);
    setCelebrationId('');
  }

  function selectPuzzle(kind: 'word-puzzle' | 'word-ladder') {
    if (game && finished) resetGame();
    setPuzzleKind(kind);
    setMessage('');
    navigateTo('play');
  }

  useEffect(() => {
    let active = true;
    let id: string | null = null;
    try {
      id = window.localStorage.getItem(LAST_GAME_KEY);
    } catch {
      /* Resume is optional when storage is unavailable. */
    }
    if (id) {
      setRestoring(true);
      readGame(id)
        .then((result) => {
          if (active) setGame(result);
        })
        .catch((error) => {
          if (!active) return;
          if (
            error instanceof ApiError &&
            [401, 403, 404].includes(error.status)
          ) {
            try {
              if (window.localStorage.getItem(LAST_GAME_KEY) === id)
                window.localStorage.removeItem(LAST_GAME_KEY);
            } catch {
              /* Storage may be unavailable. */
            }
          } else
            setMessage('Could not restore your puzzle. Reload to try again.');
        })
        .finally(() => {
          if (active) setRestoring(false);
        });
    }
    let revision = 0;
    const changed = (event: Event) => {
      active = false;
      gameReads.current.clear();
      const detail = (
        event as CustomEvent<{
          resumeGameId?: string;
          keepGuestProgress?: boolean;
        }>
      ).detail;
      if (detail?.keepGuestProgress) {
        guessSession.current++;
        setGame(null);
        setGuess('');
        setMessage('');
        setRejectedAttempt(0);
      } else resetGame();
      setRestoring(false);
      onDataChange();
      const currentRevision = ++revision;
      if (detail?.resumeGameId) {
        const resumeId = detail.resumeGameId;
        try {
          window.localStorage.setItem(LAST_GAME_KEY, resumeId);
        } catch {
          /* Resume remains available in this view. */
        }
        setRestoring(true);
        readGame(resumeId)
          .then((result) => {
            if (revision === currentRevision) setGame(result);
          })
          .catch(() => {
            if (revision === currentRevision)
              setMessage('Your puzzle is saved. Reload to resume it.');
          })
          .finally(() => {
            if (revision === currentRevision) setRestoring(false);
          });
      }
    };
    window.addEventListener('lexiplay:account-change', changed);
    return () => {
      active = false;
      revision++;
      window.removeEventListener('lexiplay:account-change', changed);
    };
  }, []);

  const finished =
    game?.completed ||
    game?.status === 'cancelled' ||
    (game?.guesses.at(-1)?.completed ?? false);
  const attemptsRemaining = game
    ? Math.max(
        0,
        game.attemptLimit - (game.attemptCount ?? game.guesses.length),
      )
    : 0;
  const setupReward =
    puzzleKind === 'word-ladder'
      ? ladderWordLength
      : Math.ceil(selectedWordLength / 2) + 2;
  useEffect(() => {
    if (accountLoading || progressSaving) return;
    if (game?.wallet && game.wallet.kind === (account ? 'account' : 'guest')) {
      if (account) bootstrapWalletUsed.current = account.id;
      setWallet(game.wallet);
      setWalletOwner(account?.id ?? 'guest');
      return;
    }
    let active = true;
    const bootstrap = account && account.activeGameId !== undefined && Number.isInteger(account.coinBalance)
      && bootstrapWalletUsed.current !== account.id;
    if (!account) bootstrapWalletUsed.current = null;
    if (bootstrap) bootstrapWalletUsed.current = account.id;
    const request = bootstrap
      ? Promise.resolve({ coinBalance: account!.coinBalance!, kind: 'account', activeGameId: account!.activeGameId })
      : api<{ coinBalance: number; kind: string; activeGameId?: string | null }>('/games/wallet');
    request
      .then(async (value) => {
        if (!active || !Number.isInteger(value.coinBalance)) return;
        setWallet(value);
        if (value.activeGameId && value.activeGameId !== game?.id) {
          setRestoring(true);
          try {
            const restored = await readGame(value.activeGameId);
            if (active) {
              guessSession.current++;
              setGuess('');
              setMessage('');
              setRejectedAttempt(0);
              try {
                localStorage.setItem(LAST_GAME_KEY, restored.id);
              } catch {
                /* The server can recover this game again. */
              }
              setGame(restored);
            }
          } catch (error) {
            if (active) {
              if (
                !account &&
                error instanceof ApiError &&
                [401, 403, 404].includes(error.status)
              )
                resetGame();
              else
                setMessage(
                  'Could not restore your puzzle. Reload to try again.',
                );
            }
          } finally {
            if (active) setRestoring(false);
          }
        }
      })
      .catch(() => {
        if (active) setWallet(null);
      })
      .finally(() => {
        if (active) setWalletOwner(account?.id ?? 'guest');
      });
    return () => {
      active = false;
    };
  }, [
    account?.id,
    accountLoading,
    progressSaving,
    game?.id,
    game?.guesses.length,
    game?.hintCoinsSpent,
    game?.wallet,
  ]);

  useEffect(() => {
    if (accountLoading) return;
    let active = true;
    wordStore.requests
      .get<{ version: string }>('/library/revision', 60_000)
      .then((value) => {
        if (!active || typeof value.version !== 'string') return;
        let previous: string | null = null;
        try {
          previous = localStorage.getItem('lexiplay-library-revision');
          localStorage.setItem('lexiplay-library-revision', value.version);
        } catch {
          /* The current view still uses the server's published data. */
        }
        if (previous !== value.version) {
          clearDictionaryCache();
          wordStore.requests.invalidate();
          wordStore.requests.prime('/library/revision', value, 60_000);
          void wordStore.loadSaved(true).catch(() => {});
          onDataChange();
          if (game)
            void api<Game>(`/games/${game.id}`)
              .then((updated) => {
                if (active) setGame(updated);
              })
              .catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [activeSection, wordStore, accountLoading]);

  useEffect(() => {
    if (game && !finished && activeSection === 'play')
      inputRef.current?.focus({ preventScroll: true });
  }, [game?.id, game?.guesses.length, finished, activeSection]);

  useEffect(() => {
    if (activeSection !== 'play') setRevealingGuess(null);
  }, [activeSection]);

  useEffect(() => {
    if (game && activeSection === 'play')
      puzzleRef.current?.scrollIntoView?.({ block: 'start' });
  }, [game?.id, activeSection]);

  async function startPractice(replay = false) {
    if (
      progressSaving ||
      accountLoading ||
      walletOwner !== (account?.id ?? 'guest')
    )
      return;
    setBusy(true);
    setMessage('');
    try {
      await wordStore.flush();
      const options = (
        replay && game ? !!game.ladder : puzzleKind === 'word-ladder'
      )
        ? {
            kind: 'word-ladder',
            wordLength: replay && game ? game.wordLength : ladderWordLength,
          }
        : {
            kind: 'word-puzzle',
            wordLength: replay && game ? game.wordLength : selectedWordLength,
            difficulty: 'medium',
            playWithMyWords: false,
            ...(selectedPoolId ? { collectionId: selectedPoolId } : {}),
          };
      const key = JSON.stringify([account?.id ?? 'guest', options]);
      if (startRequest.current?.key !== key) {
        try {
          const pending = JSON.parse(
            localStorage.getItem('lexiplay-start-request') ?? 'null',
          );
          startRequest.current =
            pending?.key === key && typeof pending.id === 'string'
              ? pending
              : null;
        } catch {
          startRequest.current = null;
        }
        startRequest.current ??= { key, id: crypto.randomUUID() };
      }
      try {
        localStorage.setItem(
          'lexiplay-start-request',
          JSON.stringify(startRequest.current),
        );
      } catch {
        /* The in-memory request still prevents repeat charges. */
      }
      const newGame = await api<Game>('/games', {
        method: 'POST',
        body: JSON.stringify({
          ...options,
          startRequestId: startRequest.current.id,
        }),
      });
      guessSession.current++;
      setCelebrationId('');
      setRejectedAttempt(0);
      setGame({
        ...newGame,
        hints: newGame.hints ?? { definition: 1 },
        revealedAbsent: newGame.revealedAbsent ?? [],
        revealedPresent: newGame.revealedPresent ?? [],
      });
      try {
        window.localStorage.setItem(LAST_GAME_KEY, newGame.id);
      } catch {
        /* Gameplay remains available without browser storage. */
      }
      setGuess('');
      startRequest.current = null;
      try {
        localStorage.removeItem('lexiplay-start-request');
      } catch {
        /* The game is already available in this view. */
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Could not start practice.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function purchaseHint(type: HintType) {
    if (!game || busy || submittingGuess.current || progressSaving || finished)
      return;
    const session = guessSession.current;
    setBusy(true);
    setMessage('');
    setRejectedAttempt(0);
    if (type === 'nextWord') submittingGuess.current = true;
    try {
      const result = await api<{
        type: HintType;
        text: string;
        hints: Game['hints'];
        cost: number;
        wallet?: GameWallet;
      }>(`/games/${game.id}/hints`, {
        method: 'POST',
        body: JSON.stringify({ type }),
      });
      if (session !== guessSession.current) return;
      const updatedGame = {
        ...game,
        ...(result.wallet ? { wallet: result.wallet } : {}),
        hints: result.hints,
        clues: { ...game.clues, [type]: result.text },
        hintCoinsSpent: (game.hintCoinsSpent ?? 0) + result.cost,
      };
      setGame(updatedGame);
      if (activeSectionRef.current === 'play') gameAudio.play('hint');
      setMessage('');
      if (type === 'nextWord') {
        setGuess(result.text);
        await checkGuess(updatedGame, result.text, session);
        inputRef.current?.focus({ preventScroll: true });
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Could not use this hint.',
      );
    } finally {
      submittingGuess.current = false;
      setBusy(false);
    }
  }

  async function submitGuess(nextGuess = guess) {
    if (
      !game ||
      busy ||
      submittingGuess.current ||
      progressSaving ||
      finished ||
      nextGuess.length !== game.wordLength
    )
      return;
    submittingGuess.current = true;
    setBusy(true);
    setMessage('');
    try {
      await checkGuess(game, nextGuess, guessSession.current);
    } finally {
      submittingGuess.current = false;
      setBusy(false);
    }
  }

  async function checkGuess(game: Game, nextGuess: string, session: number) {
    try {
      const result = await api<GuessResult>(`/games/${game.id}/guesses`, {
        method: 'POST',
        body: JSON.stringify({ guess: nextGuess.trim().toLowerCase() }),
      });
      if (session !== guessSession.current) return;
      if (result.definition)
        rememberDictionaryDefinition(result.guess, result.definition);
      if (activeSectionRef.current === 'play')
        gameAudio.play(
          result.completed
            ? result.outcome === 'WON'
              ? 'win'
              : 'complete'
            : 'guess',
        );
      if (result.answer && result.answerDefinition)
        rememberDictionaryDefinition(result.answer, result.answerDefinition);
      setRevealingGuess({ gameId: game.id, row: game.guesses.length });
      const clues = { ...game.clues };
      if (game.ladder) delete clues.nextWord;
      setGame({
        ...game,
        ...(result.wallet ? { wallet: result.wallet } : {}),
        clues,
        ...(game.ladder
          ? { hints: { definition: 0, nextWord: result.completed ? 0 : 1 } }
          : {}),
        guesses: [...game.guesses, result],
        attemptCount: game.guesses.length + 1,
        completed: result.completed,
        ...(result.completed
          ? {
              status: result.outcome === 'WON' ? 'won' : 'lost',
              answer: result.answer,
              answerDefinition: result.answerDefinition,
            }
          : {}),
      });
      setGuess('');
      setRejectedAttempt(0);
      if (result.completed) {
        wordStore.requests.invalidate('/progress/');
        if (result.outcome === 'WON') setCelebrationId(game.id);
        setMessage(
          result.outcome === 'WON'
            ? result.rewardCoins
              ? `${game.ladder ? 'Four new words!' : 'You found it!'} ${result.rewardCoins} coins earned${game.coinPayer === 'guest' && account ? ' in your guest wallet' : ''}.`
              : 'You found it! A new word is ready whenever you are.'
            : `Practice complete. The answer was ${result.answer}.`,
        );
      }
    } catch (error) {
      if (session !== guessSession.current) return;
      if (
        error instanceof ApiError &&
        (error.code === 'INVALID_LADDER_STEP' ||
          error.code === 'REPEATED_LADDER_WORD')
      ) {
        setRejectedAttempt((value) => value + 1);
        if (activeSectionRef.current === 'play') gameAudio.play('invalid');
        setMessage(error.message);
      } else if (
        error instanceof ApiError &&
        error.status === 400 &&
        (error.code === 'INVALID_GUESS' ||
          (!error.code && /valid.*word|dictionary/i.test(error.message)))
      ) {
        setRejectedAttempt((value) => value + 1);
        if (activeSectionRef.current === 'play') gameAudio.play('invalid');
        setMessage(
          `${nextGuess.toUpperCase()} is not in the dictionary. Try another word.`,
        );
      } else
        setMessage(
          error instanceof Error
            ? error.message
            : 'Could not submit your guess. Press Enter to retry.',
        );
    }
  }

  function changeGuess(nextGuess: string) {
    if (
      !game ||
      busy ||
      submittingGuess.current ||
      progressSaving ||
      finished ||
      nextGuess === guess
    )
      return;
    const cleaned = nextGuess
      .toLowerCase()
      .replace(/[^a-z]/g, '')
      .slice(0, game.wordLength);
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
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.nativeEvent.isComposing
    )
      return;
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
  for (const letter of game?.revealedAbsent ?? [])
    keyboardFeedback.set(letter.toUpperCase(), 'ABSENT');
  for (const letter of game?.revealedPresent ?? [])
    keyboardFeedback.set(letter.toUpperCase(), 'PRESENT');
  for (const result of game?.ladder ? [] : (game?.guesses ?? [])) {
    result.guess.split('').forEach((letter, index) => {
      const key = letter.toUpperCase();
      const feedback = result.feedback[index]!;
      const previous = keyboardFeedback.get(key);
      if (!previous || feedbackRank[feedback] > feedbackRank[previous])
        keyboardFeedback.set(key, feedback);
    });
  }

  return {
    wallet,
    game,
    busy,
    restoring,
    puzzleKind,
    ladderWordLength,
    selectedWordLength,
    selectedPoolId,
    firstGuestVisit,
    setupReward,
    walletOwner,
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
    setGameInputFocused,
    changeGuess,
    handleInputKeyDown,
    submitGuess,
    addLetter,
    deleteLetter,
    selectPuzzle,
    selectCollection,
    purchaseHint,
  };
}

export type PuzzleController = ReturnType<typeof usePuzzleGame>;
