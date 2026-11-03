import {
  Navigate,
  Route,
  Routes,
  useBlocker,
  useLocation,
  useNavigate,
} from 'react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sectionPaths, type Section } from './routes';
import { PendingWords } from './services/pending-words';
import { PendingWordsContext, useWordSelection } from './usePendingWords';
import { createTranslator } from './i18n';
import { usePreferences } from './PreferencesProvider';
import usePuzzleGame from './usePuzzleGame';
import WordBookmark from './WordBookmark';
import Icon, { type IconName } from './Icon';
import AccountStatus from './AccountStatus';
import useAccount from './useAccount';
import HomePage from './HomePage';
import GamePage from './GamePage';
import LicensesPage from './LicensesPage';
import GuestGameReminder from './GuestGameReminder';
import {
  GameOptions,
  GAME_OPTIONS_PATH,
  GAME_OPTIONS_LIFETIME,
} from './services/game-options';
import {
  PersonalList,
  PersonalPage,
  VocabularyCollection,
} from './collection-types';
import VocabularyLibrary from './VocabularyLibrary';
import DictionaryPage from './DictionaryPage';
import FeedbackPage from './FeedbackPage';
import AccountPage from './AccountPage';
import SettingsPage from './SettingsPage';
import CommunityPage from './CommunityPage';
import StatisticsPanel, { statisticsPath } from './StatisticsPanel';
import AnimalGuessGame from './animal-guess/AnimalGuessGame';
import { syncAnimalPractice } from './animal-guess/practice-progress';

export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const action = new URLSearchParams(location.hash.slice(1)).get('action');
  const activeSection: Section =
    action === 'reset' || action === 'verify'
      ? 'account'
      : ((Object.entries(sectionPaths).find(
          ([, path]) => path === location.pathname,
        )?.[0] as Section | undefined) ??
        (location.pathname === '/play' ? 'play' : 'home'));
  const interfacePreferences = usePreferences();
  const t = useMemo(
    () => createTranslator(interfacePreferences.language),
    [interfacePreferences.language],
  );
  const {
    account,
    setAccount,
    loading: accountLoading,
    error: accountError,
    retry: retryAccount,
    signedIn,
    progressSaving,
    progressError,
    progressMessage,
    retryProgress,
  } = useAccount();
  const [dismissedGuestReminder, setDismissedGuestReminder] = useState('');
  const [accountEntryMode, setAccountEntryMode] = useState<
    'login' | 'register'
  >('login');
  const [accountRevision, setAccountRevision] = useState(0);
  useEffect(() => {
    if (accountLoading || progressSaving || accountError) return;
    const sync = () => {
      void syncAnimalPractice(account?.id ?? 'guest');
    };
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('focus', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('focus', sync);
    };
  }, [account?.id, accountLoading, accountError, progressSaving]);
  const wordStore = useMemo(
    () => new PendingWords(account?.id ?? 'guest'),
    [account?.id],
  );
  const wordSelection = useWordSelection(wordStore);
  const [quickSearch, setQuickSearch] = useState('');
  useEffect(() => {
    if (accountLoading) return;
    void wordStore.requests
      .get<GameOptions[]>(GAME_OPTIONS_PATH, GAME_OPTIONS_LIFETIME)
      .catch(() => {});
    void wordStore.requests
      .get<VocabularyCollection[]>('/collections', 300_000)
      .catch(() => {});
    if (wordStore.owner === 'guest') return;
    void wordStore.loadSaved().catch(() => {});
    void wordStore.requests
      .get<PersonalList[]>('/word-lists/mine')
      .then((lists) => {
        const list = lists.find((item) => item.isDefault) ?? lists[0];
        if (!list) return;
        const params = new URLSearchParams({
          page: '1',
          pageSize: '25',
          language: list.preferredLanguage,
        });
        return wordStore.requests.get<PersonalPage>(
          `/word-lists/${list.id}/entries?${params}`,
        );
      })
      .catch(() => {});
  }, [accountLoading, accountRevision, wordStore]);
  useEffect(() => {
    document.documentElement.scrollTop = 0;
  }, [activeSection]);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      const target = event.target;
      if (
        event.key !== '/' ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.defaultPrevented ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            !!target.closest('input, textarea, select, [role="textbox"]')))
      )
        return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  useEffect(() => {
    if (
      !accountLoading &&
      (activeSection === 'play' ||
        activeSection === 'animal-guess' ||
        activeSection === 'library')
    )
      void wordStore.loadSaved().catch(() => {});
  }, [accountLoading, activeSection, wordStore]);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname &&
      (wordSelection.pending.size > 0 || wordSelection.saving),
  );
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    void wordStore
      .flush()
      .then(() => blocker.proceed())
      .catch(() => blocker.reset());
  }, [blocker, wordStore]);
  useEffect(() => {
    window.dispatchEvent(new Event('lexiplay:before-route-change'));
    setQuickSearch('');
  }, [location.pathname]);
  useEffect(() => {
    const leaving = () => {
      void wordStore.flush(true).catch(() => {});
    };
    window.addEventListener('pagehide', leaving);
    return () => window.removeEventListener('pagehide', leaving);
  }, [wordStore]);

  function prefetchSection(section: Section) {
    if (accountLoading) return;
    if (section === 'progress' && account)
      void wordStore.requests.get(statisticsPath(), 30_000).catch(() => {});
    if (section === 'community')
      void wordStore.requests
        .get('/community/practice-rankings', 30_000)
        .catch(() => {});
    if (section === 'library')
      void wordStore.requests.get('/collections', 300_000).catch(() => {});
    if (section === 'play')
      void wordStore.requests
        .get(GAME_OPTIONS_PATH, GAME_OPTIONS_LIFETIME)
        .catch(() => {});
  }

  function navigateTo(
    section: Section,
    search?: string,
    accountMode: 'login' | 'register' = 'login',
  ) {
    if (section === 'account') setAccountEntryMode(accountMode);
    navigate(sectionPaths[section], { state: { search: search ?? '' } });
    setQuickSearch(search ?? '');
  }

  const refreshAccountData = useCallback(() => {
    setAccountRevision((revision) => revision + 1);
  }, []);

  const puzzle = usePuzzleGame({
    account,
    accountLoading,
    accountError,
    progressSaving,
    activeSection,
    wordStore,
    navigateTo,
    onDataChange: refreshAccountData,
  });
  const {
    game,
    finished,
    restoring,
    puzzleKind,
    busy,
    selectPuzzle,
    selectCollection,
    walletOwner,
    wallet,
    playAgainRef,
  } = puzzle;
  const showGuestReminder = !!(
    activeSection === 'play' &&
    game &&
    finished &&
    game.status !== 'cancelled' &&
    !account &&
    !accountLoading &&
    !accountError &&
    dismissedGuestReminder !== game.id
  );
  const sectionTitle: Record<Section, string> = {
    home: t('Home'),
    play: t('Games'),
    library: t('Words'),
    dictionary: t('Dictionary'),
    'animal-guess': t('Guess Animal'),
    progress: t('Stats'),
    community: t('Community'),
    settings: t('Settings'),
    licenses: t('Licenses'),
    account: t('Account'),
    feedback: t('Feedback'),
  };
  const navigation: { key: Section; icon: IconName }[] = [
    { key: 'play', icon: 'play' },
    { key: 'library', icon: 'library' },
    { key: 'dictionary', icon: 'dictionary' },
    { key: 'progress', icon: 'progress' },
    { key: 'settings', icon: 'settings' },
  ];
  const statsSections = [
    { key: 'progress', label: 'Overview' },
    { key: 'community', label: 'Community' },
  ] as const;
  const settingsSections = [
    { key: 'settings', label: 'Preferences' },
    { key: 'account', label: 'Account' },
    { key: 'feedback', label: 'Feedback' },
  ] as const;
  const activeNavigationSection =
    activeSection === 'animal-guess'
      ? 'play'
      : activeSection === 'community'
        ? 'progress'
        : activeSection === 'feedback' || activeSection === 'account'
          ? 'settings'
          : activeSection;
  const sectionNavigation =
    activeNavigationSection === 'progress'
      ? statsSections
      : activeNavigationSection === 'settings'
        ? settingsSections
        : null;

  return (
    <PendingWordsContext.Provider value={wordStore}>
      <main
        className="app-shell"
        inert={showGuestReminder}
      >
        <aside className="sidebar">
          <a
            className="brand"
            href="/"
            aria-label={t('LexiPlay home')}
            onClick={(event) => {
              event.preventDefault();
              navigateTo('home');
            }}
          >
            <span className="brand-mark">L</span>
            {t(' LexiPlay')}
          </a>
          <nav aria-label={t('Main navigation')} className="main-navigation">
            {navigation.map((item) => (
              <button
                type="button"
                key={item.key}
                aria-label={sectionTitle[item.key]}
                className={activeNavigationSection === item.key ? 'active' : ''}
                aria-current={
                  activeNavigationSection === item.key ? 'page' : undefined
                }
                onPointerEnter={() => prefetchSection(item.key)}
                onFocus={() => prefetchSection(item.key)}
                onClick={() => navigateTo(item.key)}
              >
                <span className="nav-icon" aria-hidden="true">
                  <Icon name={item.icon} />
                </span>
                <span className="nav-label">{sectionTitle[item.key]}</span>
                <span className="nav-mobile-label" aria-hidden="true">
                  {sectionTitle[item.key]}
                </span>
              </button>
            ))}
          </nav>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <h1 className="sr-only">{sectionTitle[activeNavigationSection]}</h1>
            <div className="header-actions">
              <form
                className="header-search"
                role="search"
                onSubmit={(event) => {
                  event.preventDefault();
                  navigateTo('dictionary', quickSearch);
                }}
              >
                <label className="sr-only" htmlFor="quick-search">
                  {t('Quick dictionary search')}
                </label>
                <input
                  ref={searchRef}
                  id="quick-search"
                  type="search"
                  value={quickSearch}
                  onChange={(event) => setQuickSearch(event.target.value)}
                  placeholder={t('Search the dictionary')}
                  aria-keyshortcuts="/"
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') event.currentTarget.blur();
                  }}
                />
                <kbd aria-hidden="true">/</kbd>
                <button type="submit" aria-label={t('Search dictionary')}>
                  <Icon name="search" />
                </button>
              </form>
              <AccountStatus
                coinBalance={
                  walletOwner === (account?.id ?? 'guest')
                    ? wallet?.coinBalance
                    : account?.coinBalance
                }
                account={account}
                loading={accountLoading}
                error={accountError}
                onOpen={() => navigateTo('account')}
              />
              <a
                className="header-home"
                href="/"
                aria-label={t('Home')}
                title={t('Home')}
                onClick={(event) => {
                  event.preventDefault();
                  navigateTo('home');
                }}
              >
                <span className="brand-mark" aria-hidden="true">
                  L
                </span>
              </a>
            </div>
          </header>
          {wordSelection.error && (
            <p className="word-selection-error" role="alert">
              {t(wordSelection.error)}
            </p>
          )}
          {wordSelection.notice && (
            <p className="word-selection-error" role="alert">
              {t(wordSelection.notice)}
            </p>
          )}
          {sectionNavigation && (
            <nav
              className="section-navigation"
              aria-label={
                activeNavigationSection === 'progress'
                  ? t('Stats sections')
                  : t('Settings sections')
              }
            >
              {sectionNavigation.map((item) => (
                <a
                  key={item.key}
                  href={sectionPaths[item.key]}
                  onPointerEnter={() => prefetchSection(item.key)}
                  onFocus={() => prefetchSection(item.key)}
                  aria-current={activeSection === item.key ? 'page' : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    navigateTo(item.key);
                  }}
                >
                  {t(item.label)}
                </a>
              ))}
            </nav>
          )}

          {(activeSection === 'play' || activeSection === 'animal-guess') && (
            <>
              {!game && (
                <div className="page-introduction">
                  <div>
                    <h2>
                      {t('Choose your ')}
                      <span>{t('challenge.')}</span>
                    </h2>
                  </div>
                  <span className="page-intro-icon" aria-hidden="true">
                    <Icon name="play" />
                  </span>
                </div>
              )}
              <div
                className="puzzle-type-options"
                role="group"
                aria-label={t('Puzzle type')}
              >
                <button
                  type="button"
                  aria-pressed={
                    activeSection === 'play' && puzzleKind === 'word-puzzle'
                  }
                  onClick={() => selectPuzzle('word-puzzle')}
                  disabled={
                    busy ||
                    restoring ||
                    (!!game && !finished && puzzleKind !== 'word-puzzle')
                  }
                >
                  {t('Word puzzle')}
                </button>
                <button
                  type="button"
                  aria-pressed={
                    activeSection === 'play' && puzzleKind === 'word-ladder'
                  }
                  onClick={() => selectPuzzle('word-ladder')}
                  disabled={
                    busy ||
                    restoring ||
                    (!!game && !finished && puzzleKind !== 'word-ladder')
                  }
                >
                  {t('Word Ladder')}
                </button>
                <button
                  type="button"
                  aria-pressed={activeSection === 'animal-guess'}
                  onClick={() => navigateTo('animal-guess')}
                >
                  {t('Guess Animal')}
                </button>
              </div>
            </>
          )}
          <Routes
            location={
              action === 'reset' || action === 'verify'
                ? { ...location, pathname: '/account' }
                : location
            }
          >
            <Route
              path="/games/animal-guess"
              element={
                <AnimalGuessGame
                  bookmark={(term, definition) => (
                    <WordBookmark
                      disabled={accountLoading}
                      term={term}
                      definition={definition}
                    />
                  )}
                  practiceOwner={
                    accountLoading || progressSaving || accountError
                      ? null
                      : (account?.id ?? 'guest')
                  }
                />
              }
            />
            <Route
              path="/games"
              element={
                <GamePage
                  puzzle={puzzle}
                  account={account}
                  accountLoading={accountLoading}
                  accountError={accountError}
                  progressSaving={progressSaving}
                  navigateTo={navigateTo}
                />
              }
            />
            <Route
              path="/library"
              element={
                <section className="library-page">
                  <VocabularyLibrary
                    onUseCollection={selectCollection}
                    key={accountRevision}
                    signedIn={!!account}
                    searchQuery=""
                    onSignIn={() => navigateTo('account')}
                  />
                </section>
              }
            />
            <Route
              path="/dictionary"
              element={
                <DictionaryPage
                  key={accountRevision}
                  signedIn={!!account}
                  accountLoading={accountLoading}
                  searchQuery={
                    (location.state as { search?: string } | null)?.search ?? ''
                  }
                />
              }
            />
            <Route path="/feedback" element={<FeedbackPage />} />
            <Route path="/" element={<HomePage onNavigate={navigateTo} />} />
            <Route
              path="/account"
              element={
                <AccountPage
                  account={account}
                  setAccount={setAccount}
                  loading={accountLoading}
                  accountError={accountError}
                  onRetry={retryAccount}
                  onSignedIn={signedIn}
                  progressSaving={progressSaving}
                  progressError={progressError}
                  progressMessage={progressMessage}
                  onRetryProgress={retryProgress}
                  initialMode={accountEntryMode}
                />
              }
            />
            <Route
              path="/progress"
              element={
                <StatisticsPanel
                  key={accountRevision}
                  onPlay={() => navigateTo('play')}
                  onSignIn={() => navigateTo('account')}
                />
              }
            />
            <Route
              path="/community"
              element={
                <CommunityPage onExplore={() => navigateTo('library')} />
              }
            />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/licenses" element={<LicensesPage />} />
            <Route path="/play" element={<Navigate to="/games" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <footer className="workspace-footer">
            <div className="footer-links">
              <a
                href="https://github.com/Hwent"
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('Visit Hwent on GitHub (opens in a new tab)')}
              >
                {t('Hwent on GitHub ')}
                <Icon name="arrow" />
              </a>
              <a
                href="/licenses"
                onClick={(event) => {
                  event.preventDefault();
                  navigateTo('licenses');
                }}
                aria-current={activeSection === 'licenses' ? 'page' : undefined}
              >
                {t('Licenses')}
              </a>
            </div>
          </footer>
        </div>
      </main>
      {showGuestReminder && game && (
        <GuestGameReminder
          key={game.id}
          returnFocusRef={playAgainRef}
          onDismiss={() => setDismissedGuestReminder(game.id)}
          onSignIn={() => {
            setDismissedGuestReminder(game.id);
            navigateTo('account');
          }}
          onCreateAccount={() => {
            setDismissedGuestReminder(game.id);
            navigateTo('account', undefined, 'register');
          }}
        />
      )}
    </PendingWordsContext.Provider>
  );
}
