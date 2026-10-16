import type { Account } from './useAccount';
import Icon from './Icon';

export default function AccountStatus({ account, loading, error, onOpen, coinBalance }: { account: Account | null; loading: boolean; error: string; onOpen: () => void; coinBalance?: number | undefined }) {
  return <>
    {!loading && !error && coinBalance !== undefined && <span className="account-coins" aria-label={`Coin balance: ${coinBalance}`}><Icon name="coin"/><strong>{coinBalance.toLocaleString()}</strong></span>}
    <a className="account-status-link" href="/account" aria-label="Account" onClick={event => { event.preventDefault(); onOpen(); }}>
    <span className="account-avatar" aria-hidden="true">{account ? (account.username ?? account.email ?? 'Account')[0]!.toUpperCase() : '○'}</span>
    <span><strong>{account ? account.username ?? account.email ?? 'Account' : 'Account'}</strong><span className="sr-only">{loading ? 'Loading…' : error ? 'Unavailable' : account ? 'Signed in' : 'Guest'}</span></span>
    </a>
  </>;
}
