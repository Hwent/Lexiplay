import type { Account } from './useAccount';

export default function AccountStatus({ account, loading, error, onOpen }: { account: Account | null; loading: boolean; error: string; onOpen: () => void }) {
  return <a className="account-status-link" href="/account" aria-label="Account" onClick={event => { event.preventDefault(); onOpen(); }}>
    <span className="account-avatar" aria-hidden="true">{account ? (account.username ?? account.email ?? 'Account')[0]!.toUpperCase() : '○'}</span>
    <span><strong>{account ? account.username ?? account.email ?? 'Account' : 'Account'}</strong><small>{loading ? 'Loading…' : error ? 'Unavailable' : account ? 'Signed in' : 'Guest'}</small></span>
  </a>;
}
