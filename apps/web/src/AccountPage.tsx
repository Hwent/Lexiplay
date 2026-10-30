import { useTranslation } from './i18n';
import { FormEvent, useEffect, useState } from 'react';
import { apiRequest } from './services/api-client';
import { forgetPendingProgress } from './services/guest-progress';
import PasswordField from './PasswordField';
import NewAccountReward from './NewAccountReward';
import type { Account } from './useAccount';

type AccountMode = 'login' | 'register' | 'forgot' | 'reset' | 'verify';
function initialAction(defaultMode: 'login' | 'register') {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const action = params.get('action');
  return { mode: action === 'reset' || action === 'verify' ? action : defaultMode, token: params.get('token') ?? '' } as { mode: AccountMode; token: string };
}
export default function AccountPage({ account, setAccount, loading, accountError, onRetry, onSignedIn, progressSaving, progressError, progressMessage, onRetryProgress, initialMode = 'login' }: {
  account: Account | null; setAccount: (account: Account | null) => void; loading: boolean; accountError: string; onRetry: () => void;
  onSignedIn: (account: Account) => Promise<void>; progressSaving: boolean; progressError: string; progressMessage: string; onRetryProgress: () => void;
  initialMode?: 'login' | 'register';
}) {
  const t = useTranslation();
  const [action] = useState(() => initialAction(initialMode));
  const [mode, setMode] = useState<AccountMode>(action.mode);
  const [token, setToken] = useState(action.token);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [editingUsername, setEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [password, setPassword] = useState('');
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
    setMode(next); setPassword(''); setRecoveryRequested(false); clearFeedback();
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
        const body = mode === 'register' ? { username, password } : { identifier: email, password };
        const result = await apiRequest<{ user: Account }>(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(body) });
        setPassword(''); await onSignedIn(result.user);
        if (mode === 'register') setMessage('Account created. You’re ready to practise.');
      }
    } catch (error) { reportError(error); } finally { setBusy(false); }
  }
  async function signOut() {
    setBusy(true); clearFeedback();
    try {
      await apiRequest<void>('/auth/logout', { method: 'POST' }); setAccount(null); switchMode('login');
      setShowDelete(false); setDeletePassword(''); setRecoveryPassword(''); setEditingUsername(false); setNewUsername(''); setMessage('You’re signed out.'); notifyAccountChanged();
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
      if (account) forgetPendingProgress(account.id);
      setAccount(null); setShowDelete(false); setDeletePassword(''); setDeleteConfirmation(''); setRecoveryPassword(''); setEditingUsername(false); setNewUsername(''); switchMode('login');
      setMessage('Your account and saved learning data have been deleted.'); notifyAccountChanged();
    } catch (error) { reportError(error); } finally { setBusy(false); }
  }
  async function updateUsername(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); clearFeedback();
    try {
      const result = await apiRequest<{ user: Account }>('/auth/username', { method: 'POST', body: JSON.stringify({ username: newUsername.trim() }) });
      setAccount(result.user); setEditingUsername(false); setNewUsername(''); setMessage('Username updated. Use your new username to sign in.');
    } catch (error) { reportError(error); } finally { setBusy(false); }
  }
  const controlsBusy = busy || progressSaving;
  const profile = Boolean(account) && !['forgot', 'reset', 'verify'].includes(mode);
  const titles = { login: 'Welcome back.', register: 'Make yourself at home.', forgot: 'Let’s get you back in.', reset: 'A fresh start for your password.', verify: 'Verify your email address' };
  return <section className={`account-page${profile ? ' profile-page' : ''}`} aria-label={t('Account management')} aria-busy={loading || controlsBusy}>
    <div className="account-intro"><h2>{profile ? t('Your learning, in one place.') : t(titles[mode])}</h2><p>{profile ? t('A few simple settings. More room to grow.') : mode === 'register' ? t('Start with a username and password.') : mode === 'forgot' ? t('Use your recovery email to choose a new password.') : mode === 'verify' ? t('Confirm ownership of your email address. This step is optional.') : t('Pick up where you left off, one word at a time.')}</p></div>
      <div className="account-page-card">
        {loading ? null : accountError ? <><p role="alert">{t(accountError)}</p><button className="account-action" onClick={onRetry}>{t('Try again')}</button></> : profile && account ? <>
          <div className="account-profile-heading"><span className="profile-avatar" aria-hidden="true">{(account.username ?? account.email ?? 'L')[0]!.toUpperCase()}</span><div><h3>{account.username ?? account.email}</h3><p className="account-status" role="status">{t('Signed in as {0}', account.username ?? account.email)}</p></div><button className="account-secondary" onClick={() => void signOut()} disabled={controlsBusy}>{t('Sign out')}</button></div>
          <dl className="account-profile"><div><dt>{t('Username')}</dt><dd className="account-username"><span>{account.username ?? t('Not set')}</span><button className="account-link" type="button" aria-expanded={editingUsername} onClick={() => { setNewUsername(account.username ?? ''); setEditingUsername(true); clearFeedback(); }} disabled={controlsBusy || editingUsername}>{t('Change username')}</button></dd></div><div><dt>{t('Recovery email')}</dt><dd>{account.email ?? t('Not added')}</dd></div></dl>
          {editingUsername && <form className="account-form username-form" onSubmit={event => void updateUsername(event)}>
            <label htmlFor="new-username">{t('New username')}</label><input id="new-username" autoComplete="username" autoFocus required minLength={3} maxLength={32} pattern={String.raw`[a-zA-Z\p{Script=Han}][a-zA-Z0-9_\p{Script=Han}]{2,31}`} aria-describedby="username-hint" value={newUsername} onChange={event => setNewUsername(event.target.value)} disabled={controlsBusy} />
            <p className="account-hint" id="username-hint">{t('3–32 Chinese characters, letters, numbers, or underscores. Start with a Chinese character or letter.')}</p>
            <div className="account-setting-actions"><button className="account-action" type="submit" disabled={controlsBusy || newUsername.trim().length < 3 || newUsername.trim().toLowerCase() === account.username?.toLowerCase()}>{t('Save changes')}</button><button className="account-secondary" type="button" onClick={() => { setEditingUsername(false); setNewUsername(''); clearFeedback(); }} disabled={controlsBusy}>{t('Cancel')}</button></div>
          </form>}
          <section className="account-setting" aria-label={t('Email and recovery')}><div className="setting-heading"><h3>{t('Email & recovery')}</h3><span className={`account-pill${account.emailVerified ? ' verified' : ''}`}>{account.emailVerified ? t('Verified') : t('Optional')}</span></div>
            {account.email ? <><p className="setting-copy">{t('Your recovery email can help you reset a forgotten password.')}</p>{!account.emailVerified && <p className="verification-status">{t('Email not verified · optional')}</p>}<div className="account-setting-actions">{!account.emailVerified && <button className="account-secondary" onClick={() => void requestVerification()} disabled={controlsBusy}>{t('Send verification link')}</button>}<button className="account-link" onClick={() => switchMode('forgot')} disabled={controlsBusy}>{t('Reset your password')}</button></div></> : <><p className="setting-copy">{t('Add an email for password recovery. You can continue without one.')}</p><form className="account-form recovery-email-form" onSubmit={event => void addRecoveryEmail(event)}><label htmlFor="recovery-email">{t('Recovery email')}</label><input id="recovery-email" type="email" autoComplete="email" required maxLength={254} value={recoveryEmail} onChange={event => setRecoveryEmail(event.target.value)} disabled={controlsBusy} /><PasswordField id="recovery-password" label={t('Current password')} value={recoveryPassword} onChange={setRecoveryPassword} autoComplete="current-password" disabled={controlsBusy} /><button className="account-secondary" type="submit" disabled={controlsBusy}>{t('Add recovery email')}</button></form></>}
          </section>
          <section className="account-danger" aria-label={t('Delete account')}><div className="setting-heading"><h3>{t('Close your account')}</h3><span aria-hidden="true">↗</span></div><p className="setting-copy">{t('Delete your account, saved words, games, and statistics. This cannot be undone.')}</p>
            {!showDelete ? <button className="account-delete-link" onClick={() => { setShowDelete(true); clearFeedback(); }} disabled={controlsBusy}>{t('Delete account')}</button> : <form className="account-form delete-account-form" onSubmit={event => void deleteAccount(event)}><PasswordField id="delete-password" label={t('Current password')} value={deletePassword} onChange={setDeletePassword} autoComplete="current-password" disabled={controlsBusy} /><label htmlFor="delete-confirmation">{t('Type DELETE to confirm')}</label><input id="delete-confirmation" value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} autoComplete="off" required pattern="DELETE" disabled={controlsBusy} /><div className="delete-actions"><button className="account-secondary" type="button" onClick={() => { setShowDelete(false); setDeletePassword(''); setDeleteConfirmation(''); }} disabled={controlsBusy}>{t('Keep my account')}</button><button className="account-danger-button" type="submit" disabled={controlsBusy || deleteConfirmation !== 'DELETE' || deletePassword.length < 6}>{t('Permanently delete account')}</button></div></form>}
          </section>
        </> : <>
          {['login', 'register'].includes(mode) && <div className="account-tabs" role="tablist" aria-label={t('Account access')}><button role="tab" aria-selected={mode === 'login'} onClick={() => switchMode('login')} disabled={controlsBusy}>{t('Sign in')}</button><button role="tab" aria-selected={mode === 'register'} onClick={() => switchMode('register')} disabled={controlsBusy}>{t('Create account')}</button></div>}
          {mode === 'register' && <NewAccountReward/>}
          {mode === 'forgot' && recoveryRequested ? <div className="recovery-confirmation"><span aria-hidden="true">↗</span><h3>{t('Check your inbox')}</h3><p>{t('If there’s an account linked to that email, you’ll receive a reset link. It expires in 30 minutes.')}</p><button className="account-secondary" onClick={() => { setRecoveryRequested(false); clearFeedback(); }}>{t('Send another link')}</button></div> : <form className="account-form" onSubmit={event => void submit(event)}>
            {mode === 'register' && <><label htmlFor="account-username">{t('Username')}</label><input id="account-username" autoComplete="username" required minLength={3} maxLength={32} pattern={String.raw`[a-zA-Z\p{Script=Han}][a-zA-Z0-9_\p{Script=Han}]{2,31}`} value={username} onChange={event => setUsername(event.target.value)} disabled={controlsBusy} /><p className="account-hint">{t('3–32 Chinese characters, letters, numbers, or underscores. Start with a Chinese character or letter.')}</p></>}
            {['login', 'forgot'].includes(mode) && <><label htmlFor="account-email">{mode === 'login' ? t('Username or email') : t('Email')}</label><input id="account-email" type={mode === 'login' ? 'text' : 'email'} autoComplete={mode === 'login' ? 'username' : 'email'} required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={controlsBusy} /></>}
            {!['forgot', 'verify'].includes(mode) && <><PasswordField key={mode} id="account-password" label={mode === 'reset' ? t('New password') : t('Password')} value={password} onChange={setPassword} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} disabled={controlsBusy} /><p className="account-hint">{t('Use at least 6 characters.')}</p></>}
            {mode === 'verify' && <p className="setting-copy">{t('Confirm ownership of the email address linked to your LexiPlay account. This link expires after 24 hours and can be used once. Verification is optional.')}</p>}
            {mode === 'forgot' && <p className="account-hint">{t('Recovery requires an email added before you lost your password.')}</p>}
            <button className="account-action" type="submit" disabled={controlsBusy}>{mode === 'register' ? t('Create account') : mode === 'forgot' ? t('Send reset link') : mode === 'reset' ? t('Update password') : mode === 'verify' ? t('Verify email address') : t('Sign in')}<span aria-hidden="true">→</span></button>
          </form>}
          {mode === 'login' && <div className="account-form-footer"><span>{t('Can’t remember your password?')}</span><button className="account-link" onClick={() => switchMode('forgot')}>{t('Forgot password?')}</button></div>}
          {['forgot', 'reset', 'verify'].includes(mode) && <button className="account-link" onClick={() => { setToken(''); switchMode('login'); }}>{account ? t('Back to account') : t('Back to sign in')}</button>}
        </>}
        {account && <>{!progressSaving && progressError && <div className="account-feedback error" role="alert"><p>{t('You’re signed in, but guest progress has not finished saving. {0}', t(progressError))}</p><button className="account-secondary" onClick={onRetryProgress} disabled={controlsBusy}>{t('Retry saving progress')}</button></div>}{!progressSaving && progressMessage && <p className="account-feedback" role="status">{t(progressMessage)}</p>}</>}
        {message && <p className={`account-feedback${failed ? ' error' : ''}`} role={failed ? 'alert' : 'status'}>{t(message)}</p>}
      </div>
  </section>;
}
