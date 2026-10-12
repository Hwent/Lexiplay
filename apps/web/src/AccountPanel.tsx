import { FormEvent, useEffect, useState } from 'react';
import { apiRequest } from './services/api-client';

type Account = { id: string; email: string };
type AccountMode = 'login' | 'register';

export default function AccountPanel() {
  const [mode, setMode] = useState<AccountMode>('login');
  const [account, setAccount] = useState<Account | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    apiRequest<Account>('/auth/me')
      .then(user => { if (active && user) setAccount(user); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const payload = await apiRequest<{ user: Account }>(`/auth/${mode === 'register' ? 'register' : 'login'}`, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }, 'Could not sign in. Please try again.');
      setAccount(payload.user);
      setPassword('');
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not sign in. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      await apiRequest<void>('/auth/logout', { method: 'POST' }, 'Could not sign out. Please try again.');
      setAccount(null);
      setMessage('You’re signed out.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not sign out. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return <details className="account-panel">
    <summary>{account ? account.email : 'Account'}</summary>
    <div className="account-content">
      {account ? <>
        <p className="account-status" role="status">Signed in as {account.email}</p>
        <button className="account-action" type="button" onClick={() => void signOut()} disabled={busy}>Sign out</button>
      </> : <>
        <div className="account-tabs" role="tablist" aria-label="Account access">
          <button role="tab" aria-selected={mode === 'login'} type="button" onClick={() => { setMode('login'); setMessage(''); }}>Sign in</button>
          <button role="tab" aria-selected={mode === 'register'} type="button" onClick={() => { setMode('register'); setMessage(''); }}>Create account</button>
        </div>
        <form className="account-form" onSubmit={event => void submit(event)}>
          <label htmlFor="account-email">Email</label>
          <input id="account-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} />
          <label htmlFor="account-password">Password</label>
          <input id="account-password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={12} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} />
          <p className="account-hint">Use at least 12 characters.</p>
          <button className="account-action" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}</button>
        </form>
      </>}
      {message && <p className="account-message" role="status">{message}</p>}
    </div>
  </details>;
}
