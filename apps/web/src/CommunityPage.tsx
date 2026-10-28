import { useContext, useEffect, useRef, useState } from 'react';
import { LanguageContext, useTranslation } from './i18n';
import Icon from './Icon';
import EmptyState from './EmptyState';
import { apiRequest } from './services/api-client';
import './community.css';

type Ranking = { rank: number; username: string; value: number };
const boards = [
  { id: 'practice', label: 'Practice count', title: 'Practice leaderboard', value: 'Completed rounds', description: 'Top 20 by completed rounds across all games. Wins and losses count; giving up does not.', icon: 'play' },
  { id: 'streak', label: 'Streak days', title: 'Streak leaderboard', value: 'Days', description: 'Top 20 by current streak across all games. Days use UTC; your streak stays active if you played yesterday.', icon: 'sun' },
  { id: 'coin', label: 'Coins', title: 'Coin leaderboard', value: 'Coins', description: 'Top 20 accounts by current coin balance.', icon: 'coin' },
] as const;
type Board = typeof boards[number]['id'];

export default function CommunityPage({ onExplore }: { onExplore: () => void }) {
  const t = useTranslation();
  const language = useContext(LanguageContext);
  const [selected, setSelected] = useState<Board>('practice');
  const board = boards.find(item => item.id === selected)!;
  const [rankings, setRankings] = useState<Ranking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setRankings([]);
    apiRequest<(Ranking & { coinBalance?: number })[]>(`/community/${selected}-rankings`, { signal: controller.signal }, 'Could not load the leaderboard.')
      .then(result => { if (!controller.signal.aborted) setRankings(result.map(entry => ({ ...entry, value: entry.coinBalance ?? entry.value }))); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load the leaderboard.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selected, revision]);

  return <section className="community-page">
    <div className="page-introduction">
      <div><h2>{t('Leaderboards')}</h2><p>{t(board.description)}</p></div>
      <span className="page-intro-icon" aria-hidden="true"><Icon name={board.icon}/></span>
    </div>
    <div className="leaderboard-tabs" role="tablist" aria-label={t('Leaderboards')} ref={tabsRef}>
      {boards.map((item, index) => <button key={item.id} id={`ranking-tab-${item.id}`} type="button" role="tab" aria-selected={selected === item.id} aria-controls="ranking-panel" tabIndex={selected === item.id ? 0 : -1} onClick={() => setSelected(item.id)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % boards.length : event.key === 'ArrowLeft' ? (index + boards.length - 1) % boards.length : event.key === 'Home' ? 0 : event.key === 'End' ? boards.length - 1 : undefined;
        if (next === undefined) return;
        event.preventDefault(); setSelected(boards[next]!.id);
        tabsRef.current?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
      }}>{t(item.label)}</button>)}
    </div>
    <article className="coin-leaderboard" id="ranking-panel" role="tabpanel" aria-labelledby={`ranking-tab-${selected}`} aria-busy={loading}>
      {loading ? <p className="leaderboard-status" role="status">{t('Loading rankings…')}</p>
        : error ? <EmptyState icon={board.icon} title="Rankings are unavailable." action={<button type="button" className="quiet-button" onClick={() => setRevision(value => value + 1)}>{t('Try again')}</button>}><p role="status">{t(error)}</p></EmptyState>
        : rankings.length === 0 ? <EmptyState icon={board.icon} title="No rankings yet."><p>{t(selected === 'coin' ? 'Account coin balances will appear here.' : 'Complete a game while signed in to join the rankings.')}</p></EmptyState>
        : <table className="coin-ranking-table">
          <caption className="sr-only">{t(board.title)}</caption>
          <thead><tr><th scope="col">{t('Rank')}</th><th scope="col">{t('Username')}</th><th scope="col">{t(board.value)}</th></tr></thead>
          <tbody>{rankings.map((entry, index) => <tr key={index}>
            <td><span className={`coin-rank${entry.rank <= 3 ? ' top-rank' : ''}`}>{entry.rank}</span></td>
            <td><strong className="ranked-username" title={entry.username}>{entry.username}</strong></td>
            <td><span className="ranked-coins">{selected === 'coin' && <Icon name="coin"/>}<strong>{entry.value.toLocaleString(language)}</strong></span></td>
          </tr>)}</tbody>
        </table>}
    </article>
    <div className="community-footer"><button type="button" className="quiet-button" onClick={onExplore}>{t('Explore vocabulary ')}<Icon name="arrow"/></button></div>
  </section>;
}
