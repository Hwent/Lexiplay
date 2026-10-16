import { useEffect, useState } from 'react';
import { ApiError } from './services/api-client';
import Icon, { IconName } from './Icon';
import PronunciationButton from './PronunciationButton';
import usePendingWords from './usePendingWords';

type RecentGame = { id: string; wordLength: number; difficulty: string; completedAt: string; answer: string; answerDefinition?: string; status: string; attemptCount: number; coinChange: number };
type Statistics = { total: number; wins: number; losses: number; winRate: number; streak: number; timezone: string; distribution: { attempts: number; wins: number }[]; recent: RecentGame[]; page: number; pageSize: number; totalPages: number };
export default function StatisticsPanel() {
  const { store, selection } = usePendingWords();
  const [data, setData] = useState<Statistics | null>(null);
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => { void store.loadSaved().catch(() => {}); }, [store]);
  useEffect(() => {
    let active = true;
    setLoading(true); setMessage('');
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const path = `/progress/summary?timezone=${encodeURIComponent(timezone)}&page=${page}&pageSize=10`;
    store.requests.get<Statistics>(path, 30_000)
      .then(result => { if (active) setData(result); })
      .catch(error => { if (active) setMessage(error instanceof ApiError && error.status === 401 ? 'Sign in to see your saved learning progress.' : error instanceof Error ? error.message : 'Could not load your statistics.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry, page, store]);
  return <section className="statistics-page" aria-label="Learning statistics">
    <div className="page-introduction"><div><h2>Your <span>progress.</span></h2></div><span className="page-intro-icon" aria-hidden="true"><Icon name="progress" /></span></div>
    {loading && !data && <p role="status">Loading your statistics…</p>}
    {!loading && message && <div className="statistics-empty"><p role="status">{message}</p><button className="account-action" onClick={() => setRetry(value => value + 1)}>Try again</button></div>}
    {!message && data && <>
      <div className="stat-cards">{([{ label: 'Games played', value: data.total, icon: 'play' }, { label: 'Win rate', value: `${data.winRate}%`, icon: 'progress' }, { label: 'Current streak', value: `${data.streak} ${data.streak === 1 ? 'day' : 'days'}`, icon: 'sun' }, { label: 'Words solved', value: data.wins, icon: 'check' }] satisfies { label: string; value: string | number; icon: IconName }[]).map(({ label, value, icon }) => <article key={label}><span className="stat-label"><span>{label}</span><Icon name={icon} /></span><strong>{value}</strong></article>)}</div>
      {!data.total ? <div className="statistics-empty"><h3>Your first word starts the story.</h3><p>Complete a puzzle while signed in to see your progress here.</p></div> : <div className="statistics-columns">
        <article className="statistics-card recent-practice"><div className="practice-history-heading"><h3>Recent practice</h3><span>{data.total.toLocaleString()} games</span></div>
          <nav className="history-pagination" aria-label="Recent practice pages"><button type="button" disabled={loading || data.page <= 1} onClick={() => setPage(data.page - 1)}>Previous</button><span>Page {data.page} of {data.totalPages}</span><button type="button" disabled={loading || data.page >= data.totalPages} onClick={() => setPage(data.page + 1)}>Next</button></nav>
          {loading ? <p role="status">Loading practice…</p> : <div className="practice-table-scroll"><table className="recent-practice-table"><thead><tr><th scope="col">Word</th><th scope="col">Practice</th><th scope="col">Result</th><th scope="col"><span className="sr-only">Save word</span></th></tr></thead><tbody>{data.recent.map(game => {
            const saved = selection.saved.has(game.answer), pending = selection.pending.has(game.answer);
            return <tr key={game.id}><td><span className="word-with-pronunciation"><strong>{game.answer}</strong><PronunciationButton term={game.answer}/></span>{game.answerDefinition && <p className="recent-word-definition">{game.answerDefinition}</p>}</td><td><span>{game.wordLength} letters · {game.difficulty} · {game.attemptCount} guesses</span><time dateTime={game.completedAt}>{new Date(game.completedAt).toLocaleDateString()}</time></td><td><span className={`result-badge ${game.status === 'won' ? 'won' : ''}`}>{game.status === 'won' ? 'Solved' : 'Practised'}</span></td><td><button type="button" className="bookmark-button" aria-label={saved ? `${game.answer} is already in your word list` : pending ? `Cancel addition of ${game.answer}` : `Add ${game.answer} to word list`} aria-pressed={pending} disabled={saved || selection.saving || !selection.ready} onClick={() => store.toggle(game.answer, game.answerDefinition ?? '')}><Icon name={saved || pending ? 'check' : 'plus'}/><span>{saved ? 'Saved' : pending ? 'Selected' : 'Add'}</span></button></td></tr>;
          })}</tbody></table></div>}
        </article>
      </div>}
      <p className="statistics-footnote">Streaks count days with a completed puzzle in {data.timezone}. Today’s streak stays active if you practised yesterday.</p>
    </>}
  </section>;
}
