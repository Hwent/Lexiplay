import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiRequest } from './services/api-client';
import { hasPendingProgress, transferGuestProgress } from './services/guest-progress';

export type Account = { id: string; email: string | null; username?: string; emailVerified?: boolean; coinBalance?: number };
export default function useAccount() {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [progressSaving, setProgressSaving] = useState(false);
  const [progressError, setProgressError] = useState('');
  const [progressMessage, setProgressMessage] = useState('');
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const saveGuestProgress = useCallback(async (user: Account) => {
    setProgressSaving(true); setProgressError(''); setProgressMessage('');
    try {
      const result = await transferGuestProgress(user.id);
      window.dispatchEvent(new CustomEvent('lexiplay:account-change', { detail: { resumeGameId: result.resumeGameId } }));
      const words = result.wordsAdded + result.wordsAlreadySaved;
      if (words || result.gamesTransferred) setProgressMessage(`Guest progress saved to your account: ${words} word${words === 1 ? '' : 's'} and ${result.gamesTransferred} game${result.gamesTransferred === 1 ? '' : 's'}.`);
    } catch (cause) {
      setProgressError(cause instanceof Error ? cause.message : 'Could not save your guest progress. It is still on this device.');
      window.dispatchEvent(new CustomEvent('lexiplay:account-change', { detail: { keepGuestProgress: true } }));
    } finally { setProgressSaving(false); }
  }, []);
  const signedIn = useCallback(async (user: Account) => { setAccount(user); await saveGuestProgress(user); }, [saveGuestProgress]);
  const retryProgress = useCallback(() => { if (account) void saveGuestProgress(account); }, [account, saveGuestProgress]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    apiRequest<Account>('/auth/me').then(user => { if (active) { setAccount(user?.id ? user : null); if (user?.id && hasPendingProgress()) void saveGuestProgress(user); } }).catch(cause => {
      if (!active) return;
      if (cause instanceof ApiError && cause.status === 401) setAccount(null);
      else setError('Could not load your account. Please try again.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt, saveGuestProgress]);
  return { account, setAccount, loading, error, retry, signedIn, progressSaving, progressError, progressMessage, retryProgress };
}
