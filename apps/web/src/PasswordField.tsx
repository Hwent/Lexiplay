import { useEffect, useState } from 'react';

export default function PasswordField({ id, label, value, onChange, autoComplete, disabled = false }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password'; disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { if (!value) setVisible(false); }, [value]);
  return <div className="password-field">
    <label htmlFor={id}>{label}</label>
    <div className="password-input-wrap">
      <input id={id} type={visible ? 'text' : 'password'} autoComplete={autoComplete} required minLength={8} maxLength={128} value={value} onChange={event => onChange(event.target.value)} disabled={disabled} />
      <button type="button" className="password-toggle" aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`} aria-controls={id} aria-pressed={visible} onClick={() => setVisible(current => !current)} disabled={disabled}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" />{visible && <path d="M4 4 20 20" />}</svg>
      </button>
    </div>
  </div>;
}
