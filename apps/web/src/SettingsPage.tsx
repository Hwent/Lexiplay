import Icon from './Icon';

export default function SettingsPage({ theme, onThemeChange, soundEnabled, onSoundChange }: { theme: 'light' | 'dark'; onThemeChange: (theme: 'light' | 'dark') => void; soundEnabled: boolean; onSoundChange: (enabled: boolean) => void }) {
  return <section className="settings-page">
    <div className="page-introduction">
      <div><h2>Make yourself <span>comfortable.</span></h2><p>Theme and sound, just how you like them.</p></div>
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
    <div className="appearance-panel sound-panel">
      <div><h3>Sound effects</h3><p>Soft sounds for typing, hints, and rewards.</p></div>
      <button className="sound-toggle" type="button" role="switch" aria-label="Sound effects" aria-checked={soundEnabled} onClick={() => onSoundChange(!soundEnabled)}>
        <span>{soundEnabled ? 'On' : 'Off'}</span><span className="option-switch" aria-hidden="true" />
      </button>
    </div>
  </section>;
}
