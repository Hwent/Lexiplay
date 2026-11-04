import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useInterfacePreferences } from './interface-preferences';
import { LanguageContext } from './i18n';
import { gameAudio } from './services/game-audio';

type Theme = 'dark' | 'light';
const PreferencesContext = createContext<ReturnType<
  typeof usePreferencesState
> | null>(null);

function usePreferencesState() {
  const interfacePreferences = useInterfacePreferences();
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem('lexiplay-theme') === 'light'
        ? 'light'
        : 'dark';
    } catch {
      return 'dark';
    }
  });
  const [soundEnabled, setSoundEnabled] = useState(() => gameAudio.enabled);
  useEffect(() => gameAudio.listen(), []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'light' ? '#f5f6f3' : '#141a14');
    try {
      localStorage.setItem('lexiplay-theme', theme);
    } catch {
      /* Keep the selection for this visit. */
    }
  }, [theme]);

  function setSound(enabled: boolean) {
    gameAudio.setEnabled(enabled);
    setSoundEnabled(enabled);
  }
  return { ...interfacePreferences, theme, setTheme, soundEnabled, setSound };
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const preferences = usePreferencesState();
  return (
    <PreferencesContext.Provider value={preferences}>
      <LanguageContext.Provider value={preferences.language}>
        {children}
      </LanguageContext.Provider>
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const preferences = useContext(PreferencesContext);
  if (!preferences)
    throw new Error('usePreferences requires PreferencesProvider');
  return preferences;
}
