import { FormEvent, useEffect, useState } from 'react';
import { apiRequest } from './services/api-client';

type Account = { id: string; email: string; username?: string; emailVerified?: boolean };
type AccountMode = 'login' | 'register' | 'forgot' | 'reset' | 'verify';
function initialAction() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const action = params.get('action');
  return { mode: action === 'reset' || action === 'verify' ? action : 'login', token: params.get('token') ?? '' } as { mode: AccountMode; token: string };
}
export default function AccountPanel() {
  const [action] = useState(initialAction);
  const [mode, setMode] = useState<AccountMode>(action.mode);
  const [token, setToken] = useState(action.token);
  const [account, setAccount] = useState<Account | null>(null);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (action.token) window.history.replaceState({}, '', window.location.pathname + window.location.search);
    apiRequest<Account>('/auth/me').then(user => { if (active && user?.id) setAccount(user); }).catch(() => undefined);
    return () => { active = false; };
  }, [action.token]);
  function notifyAccountChanged() { window.dispatchEvent(new Event('lexiplay:account-change')); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      if (mode === 'forgot' || mode === 'reset' || mode === 'verify') {
        const path = mode === 'forgot' ? 'forgot-password' : mode === 'reset' ? 'reset-password' : 'verify-email';
        const body = mode === 'forgot' ? { email } : mode === 'reset' ? { token, password } : { token };
        const result = await apiRequest<{ message: string }>(`/auth/${path}`, { method: 'POST', body: JSON.stringify(body) });
        setMessage(result.message); setPassword('');
        if (mode === 'reset') { setAccount(null); notifyAccountChanged(); }
        if (mode === 'verify' && account) setAccount({ ...account, emailVerified: true });
        if (mode !== 'forgot') { setToken(''); setMode('login'); }
      } else {
        const body = mode === 'register' ? { email, username, password } : { identifier: email, password };
        const result = await apiRequest<{ user: Account; verificationSent?: boolean }>(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(body) });
        setAccount(result.user); setPassword(''); notifyAccountChanged();
        if (mode === 'register') setMessage(result.verificationSent === false ? 'Account created. Email delivery is unavailable; you can retry verification here.' : 'Account created. Check your email to verify your address.');
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not complete this request. Please try again.'); }
    finally { setBusy(false); }
  }
  async function signOut() {
    setBusy(true);
    try { await apiRequest<void>('/auth/logout', { method: 'POST' }); setAccount(null); setMode('login'); setMessage('You’re signed out.'); notifyAccountChanged(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not sign out.'); }
    finally { setBusy(false); }
  }
  async function resendVerification() {
    setBusy(true); setMessage('');
    try { const result = await apiRequest<{ message: string }>('/auth/verification-request', { method: 'POST' }); setMessage(result.message); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not request verification.'); }
    finally { setBusy(false); }
  }
  const actionMode = mode === 'reset' || mode === 'verify';
  return <details className="account-panel" open={actionMode || undefined}>
    <summary>{account ? account.username ?? account.email : 'Account'}</summary>
    <div className="account-content">
      {account && !actionMode ? <>
        <p className="account-status" role="status">Signed in as {account.username ?? account.email}</p>
        <p className="account-hint">{account.email}</p>
        {account.emailVerified === false && <><p className="verification-status">Email verification pending</p><button className="account-action" onClick={() => void resendVerification()} disabled={busy}>Resend verification email</button></>}
        {account.emailVerified && <p className="verification-status verified">Email verified</p>}
        <button className="account-action" onClick={() => void signOut()} disabled={busy}>Sign out</button>
      </> : <>
        {!actionMode && <div className="account-tabs" role="tablist" aria-label="Account access">
          <button role="tab" aria-selected={mode === 'login'} onClick={() => { setMode('login'); setMessage(''); }}>Sign in</button>
          <button role="tab" aria-selected={mode === 'register'} onClick={() => { setMode('register'); setMessage(''); }}>Create account</button>
        </div>}
        <form className="account-form" onSubmit={event => void submit(event)}>
          {mode === 'register' && <><label htmlFor="account-username">Username</label><input id="account-username" autoComplete="username" required minLength={3} maxLength={32} pattern="[a-zA-Z][a-zA-Z0-9_]{2,31}" value={username} onChange={event => setUsername(event.target.value)} /><p className="account-hint">3–32 letters, numbers, or underscores. Start with a letter.</p></>}
          {!actionMode && <><label htmlFor="account-email">{mode === 'login' ? 'Username or email' : 'Email'}</label><input id="account-email" type={mode === 'login' ? 'text' : 'email'} autoComplete={mode === 'login' ? 'username' : 'email'} required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /></>}
          {mode !== 'forgot' && mode !== 'verify' && <><label htmlFor="account-password">{mode === 'reset' ? 'New password' : 'Password'}</label><input id="account-password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={8} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} /><p className="account-hint">Use at least 8 characters.</p></>}
          {mode === 'verify' && <p>Confirm your email address to finish setting up your account.</p>}
          <button className="account-action" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Update password' : mode === 'verify' ? 'Verify my email' : 'Sign in'}</button>
        </form>
        {mode === 'login' && <button className="account-link" onClick={() => { setMode('forgot'); setMessage(''); }}>Forgot password?</button>}
        {mode === 'forgot' && <button className="account-link" onClick={() => setMode('login')}>Back to sign in</button>}
      </>}
      {message && <p className="account-message" role="status">{message}</p>}
    </div>
  </details>;
}
