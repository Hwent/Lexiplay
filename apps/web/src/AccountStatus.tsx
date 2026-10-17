import type { Account } from './useAccount';
import Icon from './Icon';
import { useEffect, useRef, useState } from 'react';
import { gameAudio } from './services/game-audio';

export default function AccountStatus({ account, loading, error, onOpen, coinBalance }: { account: Account | null; loading: boolean; error: string; onOpen: () => void; coinBalance?: number | undefined }) {
  const owner = account?.id ?? 'guest';
  const previous = useRef({ owner, coinBalance });
  const [change, setChange] = useState<{ amount: number; sequence: number } | null>(null);
  useEffect(() => {
    const last = previous.current;
    previous.current = { owner, coinBalance };
    if (owner !== last.owner || loading || error || coinBalance === undefined || last.coinBalance === undefined || coinBalance === last.coinBalance) {
      setChange(null);
      return;
    }
    setChange(value => ({ amount: coinBalance - last.coinBalance!, sequence: (value?.sequence ?? 0) + 1 }));
    if (coinBalance > last.coinBalance) gameAudio.play('coin');
    const timer = window.setTimeout(() => setChange(null), 1500);
    return () => window.clearTimeout(timer);
  }, [owner, coinBalance, loading, error]);
  return <>
    {!loading && !error && coinBalance !== undefined && <span className={`account-coins${change ? ' coins-changed' : ''}`} aria-label={`Coin balance: ${coinBalance}`}><Icon name="coin"/><strong>{coinBalance.toLocaleString()}</strong>{change && <span key={change.sequence} className={`coin-change${change.amount > 0 ? ' earned' : ''}`} aria-hidden="true">{change.amount > 0 ? '+' : '−'}{Math.abs(change.amount)}</span>}</span>}
    <a className="account-status-link" href="/account" aria-label="Account" aria-busy={loading} onClick={event => { event.preventDefault(); onOpen(); }}>
    <span className="account-avatar" aria-hidden="true">{account ? (account.username ?? account.email ?? 'Account')[0]!.toUpperCase() : '○'}</span>
    <span><strong>{account ? account.username ?? account.email ?? 'Account' : 'Account'}</strong><span className="sr-only">{loading ? '' : error ? 'Unavailable' : account ? 'Signed in' : 'Guest'}</span></span>
    </a>
  </>;
}
