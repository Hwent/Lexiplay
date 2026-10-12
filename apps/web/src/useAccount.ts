import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiRequest } from './services/api-client';

export type Account = { id: string; email: string; username?: string; emailVerified?: boolean };
export default function useAccount() {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    apiRequest<Account>('/auth/me').then(user => { if (active) setAccount(user?.id ? user : null); }).catch(cause => {
      if (!active) return;
      if (cause instanceof ApiError && cause.status === 401) setAccount(null);
      else setError('Could not load your account. Please try again.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);
  return { account, setAccount, loading, error, retry };
}
