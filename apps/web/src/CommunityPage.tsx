import { useContext, useEffect, useState } from 'react';
import { LanguageContext, useTranslation } from './i18n';
import Icon from './Icon';
import EmptyState from './EmptyState';
import { apiRequest } from './services/api-client';
import './community.css';

type CoinRanking = { rank: number; username: string; coinBalance: number };

export default function CommunityPage({ onExplore }: { onExplore: () => void }) {
  const t = useTranslation();
  const language = useContext(LanguageContext);
  const [rankings, setRankings] = useState<CoinRanking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    apiRequest<CoinRanking[]>('/community/coin-rankings', { signal: controller.signal }, 'Could not load the coin leaderboard.')
      .then(result => { if (!controller.signal.aborted) setRankings(result); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load the coin leaderboard.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  return <section className="community-page">
    <div className="page-introduction">
      <div><h2>{t('Coin leaderboard')}</h2><p>{t('Top 20 accounts by current coin balance.')}</p></div>
      <span className="page-intro-icon" aria-hidden="true"><Icon name="coin" /></span>
    </div>
    <article className="coin-leaderboard" aria-label={t('Coin leaderboard')} aria-busy={loading}>
      {loading ? <p className="leaderboard-status" role="status">{t('Loading rankings…')}</p>
        : error ? <EmptyState icon="coin" title="Rankings are unavailable." action={<button type="button" className="quiet-button" onClick={() => setRevision(value => value + 1)}>{t('Try again')}</button>}><p role="status">{t(error)}</p></EmptyState>
        : rankings.length === 0 ? <EmptyState icon="coin" title="No rankings yet."><p>{t('Account coin balances will appear here.')}</p></EmptyState>
        : <table className="coin-ranking-table">
          <caption className="sr-only">{t('Coin leaderboard')}</caption>
          <thead><tr><th scope="col">{t('Rank')}</th><th scope="col">{t('Username')}</th><th scope="col">{t('Coins')}</th></tr></thead>
          <tbody>{rankings.map((entry, index) => <tr key={index}>
            <td><span className={`coin-rank${entry.rank <= 3 ? ' top-rank' : ''}`}>{entry.rank}</span></td>
            <td><strong className="ranked-username">{entry.username}</strong></td>
            <td><span className="ranked-coins"><Icon name="coin"/><strong>{entry.coinBalance.toLocaleString(language)}</strong></span></td>
          </tr>)}</tbody>
        </table>}
    </article>
    <div className="community-footer"><p>{t('Only the first letter of each username is shown. Equal balances share a rank.')}</p><button type="button" className="quiet-button" onClick={onExplore}>{t('Explore vocabulary ')}<Icon name="arrow"/></button></div>
  </section>;
}
