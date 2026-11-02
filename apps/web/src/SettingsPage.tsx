import type { LanguagePreference } from './interface-preferences';
import Icon from './Icon';
import { useTranslation } from './i18n';
import { usePreferences } from './PreferencesProvider';

export default function SettingsPage() {
  const {
    theme,
    setTheme: onThemeChange,
    soundEnabled,
    setSound: onSoundChange,
    fontSize,
    setFontSize: onFontSizeChange,
    languagePreference: language,
    setLanguage: onLanguageChange,
  } = usePreferences();
  const t = useTranslation();
  return (
    <section
      className="settings-page compact-settings"
      aria-label={t('Preferences')}
    >
      <div className="settings-group">
        <div className="settings-row">
          <span className="settings-row-label">
            <Icon name="moon" />
            {t('Appearance')}
          </span>
          <div
            className="settings-segments"
            role="group"
            aria-label={t('Appearance')}
          >
            {(['light', 'dark'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-label={t(option === 'light' ? 'Light mode' : 'Dark mode')}
                aria-pressed={theme === option}
                onClick={() => onThemeChange(option)}
              >
                <Icon name={option === 'light' ? 'sun' : 'moon'} />
              </button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">
            <Icon name="type" />
            {t('Font size')}
          </span>
          <div
            className="settings-segments font-size-segments"
            role="group"
            aria-label={t('Font size')}
          >
            {(['small', 'medium', 'large'] as const).map((size, index) => (
              <button
                key={size}
                type="button"
                aria-pressed={fontSize === size}
                onClick={() => onFontSizeChange(size)}
              >
                {t(['Small', 'Default', 'Large'][index]!)}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <label className="settings-row-label" htmlFor="interface-language">
            <Icon name="language" />
            {t('Language')}
          </label>
          <select
            id="interface-language"
            value={language}
            onChange={(event) =>
              onLanguageChange(event.target.value as LanguagePreference)
            }
          >
            <option value="auto">{t('Follow browser')}</option>
            <option value="en" lang="en">
              English
            </option>
            <option value="zh-CN" lang="zh-CN">
              简体中文
            </option>
          </select>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">
            <Icon name="sound" />
            {t('Sound effects')}
          </span>
          <button
            className="settings-switch"
            type="button"
            role="switch"
            aria-label={t('Sound effects')}
            aria-checked={soundEnabled}
            onClick={() => onSoundChange(!soundEnabled)}
          >
            <span className="settings-switch-thumb" />
          </button>
        </div>
      </div>
    </section>
  );
}
