import { useEffect, useState } from 'react';
import { ApiError, apiRequest } from './services/api-client';

type RecentGame = { id: string; wordLength: number; difficulty: string; completedAt: string; guesses: { outcome?: string; answer?: string }[] };
type Statistics = { total: number; wins: number; losses: number; winRate: number; streak: number; timezone: string; distribution: { attempts: number; wins: number }[]; recent: RecentGame[] };
export default function StatisticsPanel() {
  const [data, setData] = useState<Statistics | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setMessage('');
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    apiRequest<Statistics>(`/progress/summary?timezone=${encodeURIComponent(timezone)}`)
      .then(result => { if (active) setData(result); })
      .catch(error => { if (active) setMessage(error instanceof ApiError && error.status === 401 ? 'Sign in to see your saved learning progress.' : error instanceof Error ? error.message : 'Could not load your statistics.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);
  const distributionMax = Math.max(1, ...(data?.distribution.map(item => item.wins) ?? []));
  return <section className="statistics-page" aria-label="Learning statistics">
    <div className="section-intro"><div><p className="eyebrow">EVERY WORD COUNTS</p><h2>Your learning progress</h2><p>A record of the practice you’ve completed.</p></div></div>
    {loading && <p role="status">Loading your statistics…</p>}
    {!loading && message && <div className="statistics-empty"><p role="status">{message}</p><button className="account-action" onClick={() => setRetry(value => value + 1)}>Try again</button></div>}
    {!loading && !message && data && <>
      <div className="stat-cards">{[['Games played', data.total], ['Win rate', `${data.winRate}%`], ['Current streak', `${data.streak} ${data.streak === 1 ? 'day' : 'days'}`], ['Words solved', data.wins]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
      {!data.total ? <div className="statistics-empty"><h3>Your first word starts the story.</h3><p>Complete a puzzle while signed in to see your progress here.</p></div> : <div className="statistics-columns">
        <article className="statistics-card"><h3>Winning guesses</h3><p>How many guesses it took to solve a word.</p><div className="guess-distribution" role="list" aria-label="Winning attempt distribution">{data.distribution.map(row => <div role="listitem" key={row.attempts}><span>{row.attempts}</span><meter min={0} max={distributionMax} value={row.wins} aria-label={`${row.attempts} guesses: ${row.wins} wins`} /><strong>{row.wins}</strong></div>)}</div><p>{data.losses} {data.losses === 1 ? 'puzzle' : 'puzzles'} ended without a solution.</p></article>
        <article className="statistics-card"><h3>Recent practice</h3><ul className="recent-games">{data.recent.map(game => { const result = game.guesses.at(-1); return <li key={game.id}><div><strong>{result?.answer}</strong><span>{game.wordLength} letters · {game.difficulty} · {game.guesses.length} guesses</span><time dateTime={game.completedAt}>{new Date(game.completedAt).toLocaleDateString()}</time></div><span className={`result-badge ${result?.outcome === 'WON' ? 'won' : ''}`}>{result?.outcome === 'WON' ? 'Solved' : 'Practised'}</span></li>; })}</ul></article>
      </div>}
      <p className="statistics-footnote">Streaks count days with a completed puzzle in {data.timezone}. Today’s streak stays active if you practised yesterday.</p>
    </>}
  </section>;
}
