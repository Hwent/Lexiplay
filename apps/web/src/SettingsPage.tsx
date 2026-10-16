import Icon from './Icon';

export default function SettingsPage({ theme, onThemeChange }: { theme: 'light' | 'dark'; onThemeChange: (theme: 'light' | 'dark') => void }) {
  return <section className="settings-page">
    <div className="page-introduction">
      <div><p className="page-eyebrow">YOUR SPACE, YOUR PACE</p><h2>Make yourself<br /><span>comfortable.</span></h2><p>A little personal touch for your daily practice.</p></div>
      <span className="page-intro-icon" aria-hidden="true"><Icon name="settings" /></span>
    </div>
    <div className="appearance-panel">
      <h3>Appearance</h3><p>Choose the theme that feels comfortable.</p>
      <div className="theme-options">
        {(['light', 'dark'] as const).map(option => <button key={option} type="button" aria-pressed={theme === option} onClick={() => onThemeChange(option)}>
          <span className={`theme-preview theme-preview-${option}`} aria-hidden="true">
            <span className="theme-preview-nav" />
            <span className="theme-preview-content"><i /><i /><span><i /><i /></span></span>
          </span>
          <span className="theme-option-label">
            <Icon name={option === 'light' ? 'sun' : 'moon'} /><strong>{option === 'light' ? 'Light mode' : 'Dark mode'}</strong>
            <span className="theme-option-check" aria-hidden="true">{theme === option && <Icon name="check" />}</span>
          </span>
        </button>)}
      </div>
      <p className="appearance-note">Your preference is saved on this device.</p>
    </div>
  </section>;
}
