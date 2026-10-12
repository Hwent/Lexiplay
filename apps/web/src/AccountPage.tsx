import { FormEvent, useEffect, useState } from 'react';
import { apiRequest } from './services/api-client';
import PasswordField from './PasswordField';
import type { Account } from './useAccount';

type AccountMode = 'login' | 'register' | 'forgot' | 'reset' | 'verify';
function initialAction() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const action = params.get('action');
  return { mode: action === 'reset' || action === 'verify' ? action : 'login', token: params.get('token') ?? '' } as { mode: AccountMode; token: string };
}
export default function AccountPage({ account, setAccount, loading, accountError, onRetry }: {
  account: Account | null; setAccount: (account: Account | null) => void; loading: boolean; accountError: string; onRetry: () => void;
}) {
  const [action] = useState(initialAction);
  const [mode, setMode] = useState<AccountMode>(action.mode);
  const [token, setToken] = useState(action.token);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [sendVerification, setSendVerification] = useState(false);
  const [recoveryRequested, setRecoveryRequested] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (action.token) window.history.replaceState({}, '', '/account' + window.location.search); }, [action.token]);
  function notifyAccountChanged() { window.dispatchEvent(new Event('lexiplay:account-change')); }
  function clearFeedback() { setMessage(''); setFailed(false); }
  function reportError(error: unknown) { setFailed(true); setMessage(error instanceof Error ? error.message : 'Could not complete this request. Please try again.'); }
  function switchMode(next: AccountMode) {
    setMode(next); setPassword(''); setSendVerification(false); setRecoveryRequested(false); clearFeedback();
    if (next === 'forgot') setEmail(account?.email ?? (email.includes('@') ? email : ''));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); clearFeedback();
    try {
      if (mode === 'forgot' || mode === 'reset' || mode === 'verify') {
        const path = mode === 'forgot' ? 'forgot-password' : mode === 'reset' ? 'reset-password' : 'verify-email';
        const body = mode === 'forgot' ? { email } : mode === 'reset' ? { token, password } : { token };
        const result = await apiRequest<{ message: string }>(`/auth/${path}`, { method: 'POST', body: JSON.stringify(body) });
        setPassword('');
        if (mode === 'forgot') setRecoveryRequested(true);
        if (mode === 'reset') { setAccount(null); notifyAccountChanged(); }
        if (mode === 'verify' && account) onRetry();
        if (mode !== 'forgot') { setToken(''); setMode('login'); }
        setMessage(result.message);
      } else {
        const requested = Boolean(email.trim()) && sendVerification;
        const body = mode === 'register' ? { email: email.trim() || undefined, username, password, sendVerification: requested } : { identifier: email, password };
        const result = await apiRequest<{ user: Account; verificationSent?: boolean }>(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(body) });
        setAccount(result.user); setPassword(''); notifyAccountChanged();
        if (mode === 'register') setMessage(requested ? result.verificationSent ? 'Account created. Check your email for the optional verification link.' : 'Account created. Verification email is unavailable; you can request it later.' : 'Account created. You’re ready to practise.');
      }
    } catch (error) { reportError(error); } finally { setBusy(false); }
  }
  async function signOut() {
    setBusy(true); clearFeedback();
    try {
      await apiRequest<void>('/auth/logout', { method: 'POST' }); setAccount(null); switchMode('login');
      setShowDelete(false); setDeletePassword(''); setRecoveryPassword(''); setMessage('You’re signed out.'); notifyAccountChanged();
    } catch (error) { reportError(error); } finally { setBusy(false); }
  }
  async function requestVerification() {
    setBusy(true); clearFeedback();
    try { const result = await apiRequest<{ message: string }>('/auth/verification-request', { method: 'POST' }); setMessage(result.message); }
    catch (error) { reportError(error); } finally { setBusy(false); }
  }
  async function addRecoveryEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); clearFeedback();
    try {
      const result = await apiRequest<{ user: Account }>('/auth/email', { method: 'POST', body: JSON.stringify({ email: recoveryEmail, password: recoveryPassword }) });
      setAccount(result.user); setRecoveryPassword(''); setRecoveryEmail(''); setMessage('Recovery email added. Verification is optional.');
    } catch (error) { reportError(error); } finally { setBusy(false); }
  }
  async function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); clearFeedback();
    try {
      await apiRequest<void>('/auth/account', { method: 'DELETE', body: JSON.stringify({ password: deletePassword, confirmation: deleteConfirmation }) });
      setAccount(null); setShowDelete(false); setDeletePassword(''); setDeleteConfirmation(''); setRecoveryPassword(''); switchMode('login');
      setMessage('Your account and saved learning data have been deleted.'); notifyAccountChanged();
    } catch (error) { reportError(error); } finally { setBusy(false); }
  }
  const profile = Boolean(account) && !['forgot', 'reset', 'verify'].includes(mode);
  const titles = { login: 'Welcome back.', register: 'Make yourself at home.', forgot: 'Let’s get you back in.', reset: 'A fresh start for your password.', verify: 'Your email, confirmed.' };
  return <section className={`account-page${profile ? ' profile-page' : ''}`} aria-label="Account management">
    <div className="account-intro"><p className="eyebrow">YOUR ACCOUNT</p><h2>{profile ? 'Your learning, in one place.' : titles[mode]}</h2><p>{profile ? 'A few simple settings. More room to grow.' : mode === 'register' ? 'Start with a username and password. Email is your choice.' : mode === 'forgot' ? 'Use your recovery email to choose a new password.' : mode === 'verify' ? 'Verification is optional. Confirm this address when you’re ready.' : 'Pick up where you left off, one word at a time.'}</p></div>
    <div className="account-layout">
      <aside className="account-story" aria-label="Your learning space"><div className="account-story-mark" aria-hidden="true">L</div><p className="eyebrow">SMALL STEPS, STRONGER WORDS</p><h3>Make learning<br />your own.</h3><p>Your words. Your progress. A little practice that adds up.</p><ul><li><span aria-hidden="true">✓</span>A vocabulary list that grows with you</li><li><span aria-hidden="true">✓</span>Saved puzzles and learning history</li><li><span aria-hidden="true">✓</span>Email and verification, on your terms</li></ul><span className="account-story-flower" aria-hidden="true">✳</span></aside>
      <div className="account-page-card">
        {loading ? <p role="status">Loading your account…</p> : accountError ? <><p role="alert">{accountError}</p><button className="account-action" onClick={onRetry}>Try again</button></> : profile && account ? <>
          <div className="account-profile-heading"><span className="profile-avatar" aria-hidden="true">{(account.username ?? account.email ?? 'L')[0]!.toUpperCase()}</span><div><h3>{account.username ?? account.email}</h3><p className="account-status" role="status">Signed in as {account.username ?? account.email}</p></div><button className="account-secondary" onClick={() => void signOut()} disabled={busy}>Sign out</button></div>
          <dl className="account-profile"><div><dt>Username</dt><dd>{account.username ?? 'Not set'}</dd></div><div><dt>Recovery email</dt><dd>{account.email ?? 'Not added'}</dd></div></dl>
          <section className="account-setting" aria-label="Email and recovery"><div className="setting-heading"><h3>Email & recovery</h3><span className={`account-pill${account.emailVerified ? ' verified' : ''}`}>{account.emailVerified ? 'Verified' : 'Optional'}</span></div>
            {account.email ? <><p className="setting-copy">Your recovery email can help you reset a forgotten password.</p>{!account.emailVerified && <p className="verification-status">Email not verified · optional</p>}<div className="account-setting-actions">{!account.emailVerified && <button className="account-secondary" onClick={() => void requestVerification()} disabled={busy}>Send verification link</button>}<button className="account-link" onClick={() => switchMode('forgot')} disabled={busy}>Reset your password</button></div></> : <><p className="setting-copy">Add an email for password recovery. You can continue without one.</p><form className="account-form recovery-email-form" onSubmit={event => void addRecoveryEmail(event)}><label htmlFor="recovery-email">Recovery email</label><input id="recovery-email" type="email" autoComplete="email" required maxLength={254} value={recoveryEmail} onChange={event => setRecoveryEmail(event.target.value)} disabled={busy} /><PasswordField id="recovery-password" label="Current password" value={recoveryPassword} onChange={setRecoveryPassword} autoComplete="current-password" disabled={busy} /><button className="account-secondary" type="submit" disabled={busy}>Add recovery email</button></form></>}
          </section>
          <section className="account-danger" aria-label="Delete account"><div className="setting-heading"><h3>Close your account</h3><span aria-hidden="true">↗</span></div><p className="setting-copy">Delete your account, saved words, games, and statistics. This cannot be undone.</p>
            {!showDelete ? <button className="account-delete-link" onClick={() => { setShowDelete(true); clearFeedback(); }} disabled={busy}>Delete account</button> : <form className="account-form delete-account-form" onSubmit={event => void deleteAccount(event)}><PasswordField id="delete-password" label="Current password" value={deletePassword} onChange={setDeletePassword} autoComplete="current-password" disabled={busy} /><label htmlFor="delete-confirmation">Type DELETE to confirm</label><input id="delete-confirmation" value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} autoComplete="off" required pattern="DELETE" disabled={busy} /><div className="delete-actions"><button className="account-secondary" type="button" onClick={() => { setShowDelete(false); setDeletePassword(''); setDeleteConfirmation(''); }} disabled={busy}>Keep my account</button><button className="account-danger-button" type="submit" disabled={busy || deleteConfirmation !== 'DELETE' || deletePassword.length < 8}>{busy ? 'Deleting…' : 'Permanently delete account'}</button></div></form>}
          </section>
        </> : <>
          {['login', 'register'].includes(mode) && <div className="account-tabs" role="tablist" aria-label="Account access"><button role="tab" aria-selected={mode === 'login'} onClick={() => switchMode('login')} disabled={busy}>Sign in</button><button role="tab" aria-selected={mode === 'register'} onClick={() => switchMode('register')} disabled={busy}>Create account</button></div>}
          {mode === 'forgot' && recoveryRequested ? <div className="recovery-confirmation"><span aria-hidden="true">↗</span><h3>Check your inbox</h3><p>If there’s an account linked to that email, you’ll receive a reset link. It expires in 30 minutes.</p><button className="account-secondary" onClick={() => { setRecoveryRequested(false); clearFeedback(); }}>Send another link</button></div> : <form className="account-form" onSubmit={event => void submit(event)}>
            {mode === 'register' && <><label htmlFor="account-username">Username</label><input id="account-username" autoComplete="username" required minLength={3} maxLength={32} pattern="[a-zA-Z][a-zA-Z0-9_]{2,31}" value={username} onChange={event => setUsername(event.target.value)} disabled={busy} /><p className="account-hint">3–32 letters, numbers, or underscores. Start with a letter.</p></>}
            {!['reset', 'verify'].includes(mode) && <><label htmlFor="account-email">{mode === 'login' ? 'Username or email' : 'Email'}{mode === 'register' && <> <span className="field-optional">optional</span></>}</label><input id="account-email" type={mode === 'login' ? 'text' : 'email'} autoComplete={mode === 'login' ? 'username' : 'email'} required={mode !== 'register'} maxLength={254} value={email} onChange={event => { setEmail(event.target.value); if (!event.target.value.trim()) setSendVerification(false); }} disabled={busy} />{mode === 'register' && <p className="account-hint">Add an email if you’d like password recovery. You can add one later.</p>}</>}
            {!['forgot', 'verify'].includes(mode) && <><PasswordField key={mode} id="account-password" label={mode === 'reset' ? 'New password' : 'Password'} value={password} onChange={setPassword} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} disabled={busy} /><p className="account-hint">Use at least 8 characters.</p></>}
            {mode === 'register' && <label className="verification-choice"><input type="checkbox" checked={sendVerification} onChange={event => setSendVerification(event.target.checked)} disabled={busy || !email.trim()} /><span>Send me a verification email<small>Optional. You can use LexiPlay without verification.</small></span></label>}
            {mode === 'verify' && <p className="setting-copy">Confirm this email address. You can use your account whether or not you verify it.</p>}
            {mode === 'forgot' && <p className="account-hint">Recovery requires an email added before you lost your password.</p>}
            <button className="account-action" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Update password' : mode === 'verify' ? 'Verify my email' : 'Sign in'}<span aria-hidden="true">→</span></button>
          </form>}
          {mode === 'login' && <div className="account-form-footer"><span>Can’t remember your password?</span><button className="account-link" onClick={() => switchMode('forgot')}>Forgot password?</button></div>}
          {['forgot', 'reset', 'verify'].includes(mode) && <button className="account-link" onClick={() => { setToken(''); switchMode('login'); }}>{account ? 'Back to account' : 'Back to sign in'}</button>}
        </>}
        {message && <p className={`account-feedback${failed ? ' error' : ''}`} role={failed ? 'alert' : 'status'}>{message}</p>}
      </div>
    </div>
  </section>;
}
