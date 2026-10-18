import { useEffect, useState } from 'react';

export type LanguagePreference = 'auto' | 'en' | 'zh-CN';
export type InterfaceLanguage = Exclude<LanguagePreference, 'auto'>;
export type FontSize = 'small' | 'medium' | 'large';
type InterfacePreferences = { language: LanguagePreference; fontSize: FontSize };
const KEY = 'lexiplay-interface-preferences';

export function readInterfacePreferences(): InterfacePreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      language: ['auto', 'en', 'zh-CN'].includes(saved.language) ? saved.language : 'auto',
      fontSize: ['small', 'medium', 'large'].includes(saved.fontSize) ? saved.fontSize : 'medium',
    };
  } catch { return { language: 'auto', fontSize: 'medium' }; }
}

export function resolveLanguage(preference: LanguagePreference, languages: readonly string[]): InterfaceLanguage {
  if (preference !== 'auto') return preference;
  for (const language of languages) {
    if (/^zh(?:-|$)/i.test(language)) return 'zh-CN';
    if (/^en(?:-|$)/i.test(language)) return 'en';
  }
  return 'en';
}

export function useInterfacePreferences() {
  const [preferences, setPreferences] = useState(readInterfacePreferences);
  const [browserLanguages, setBrowserLanguages] = useState(() => navigator.languages.length ? navigator.languages : [navigator.language]);
  const language = resolveLanguage(preferences.language, browserLanguages);

  useEffect(() => {
    const changed = () => setBrowserLanguages(navigator.languages.length ? navigator.languages : [navigator.language]);
    window.addEventListener('languagechange', changed);
    return () => window.removeEventListener('languagechange', changed);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = language === 'zh-CN' ? 'LexiPlay — 学习新单词' : 'LexiPlay — Learn new words';
    document.documentElement.dataset.fontSize = preferences.fontSize;
    try { localStorage.setItem(KEY, JSON.stringify(preferences)); } catch { /* Keep preferences for this visit. */ }
  }, [preferences, language]);

  return {
    language, languagePreference: preferences.language, fontSize: preferences.fontSize,
    setLanguage: (language: LanguagePreference) => setPreferences(current => ({ ...current, language })),
    setFontSize: (fontSize: FontSize) => setPreferences(current => ({ ...current, fontSize })),
  };
}
