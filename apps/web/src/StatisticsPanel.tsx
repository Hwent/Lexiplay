import { LanguageContext, useTranslation } from './i18n';
import { useContext, useEffect, useState } from 'react';
import { ApiError } from './services/api-client';
import Icon, { IconName } from './Icon';
import PronunciationButton from './PronunciationButton';
import usePendingWords from './usePendingWords';
import EmptyState from './EmptyState';

type RecentGame = { id: string; wordLength: number; difficulty: string; completedAt: string; answer: string; answerDefinition?: string; status: string; attemptCount: number; coinChange: number };
type Statistics = { total: number; wins: number; losses: number; winRate: number; streak: number; timezone: string; distribution: { attempts: number; wins: number }[]; recent: RecentGame[]; page: number; pageSize: number; totalPages: number };
export default function StatisticsPanel({ onPlay, onSignIn }: { onPlay: () => void; onSignIn: () => void }) {
  const t = useTranslation();
  const language = useContext(LanguageContext);
  const { store, selection } = usePendingWords();
  const [data, setData] = useState<Statistics | null>(null);
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState('');
  const [signInRequired, setSignInRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => { void store.loadSaved().catch(() => {}); }, [store]);
  useEffect(() => {
    let active = true;
    setLoading(true); setMessage(''); setSignInRequired(false);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const path = `/progress/summary?timezone=${encodeURIComponent(timezone)}&page=${page}&pageSize=10`;
    store.requests.get<Statistics>(path, 30_000)
      .then(result => { if (active) setData(result); })
      .catch(error => {
        if (!active) return;
        const needsAccount = error instanceof ApiError && error.status === 401;
        setSignInRequired(needsAccount);
        setMessage(needsAccount ? 'Sign in to see your saved learning progress.' : error instanceof Error ? error.message : 'Could not load your statistics.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry, page, store]);
  return <section className="statistics-page" aria-label={t('Learning statistics')} aria-busy={loading}>
    <div className="page-introduction"><div><h2>{t('Your ')}<span>{t('progress.')}</span></h2></div><span className="page-intro-icon" aria-hidden="true"><Icon name="progress" /></span></div>
    {!loading && message && <EmptyState icon="progress" title={signInRequired ? t('Keep your progress together.') : t('Progress is unavailable.')} action={signInRequired ? <button className="primary-button" onClick={onSignIn}>{t('Sign in ')}<Icon name="arrow"/></button> : <button className="quiet-button" onClick={() => setRetry(value => value + 1)}>{t('Try again')}</button>}><p role="status">{t(message)}</p></EmptyState>}
    {!message && data && !data.total && <EmptyState icon="play" title={t('Your first word starts the story.')} action={<button className="primary-button" onClick={onPlay}>{t('Start a puzzle ')}<Icon name="arrow"/></button>}><p>{t('Complete a puzzle while signed in to see your progress here.')}</p></EmptyState>}
    {!message && data && data.total > 0 && <>
      <div className="stat-cards">{([{ label: 'Games played', value: data.total, icon: 'play' }, { label: 'Win rate', value: `${data.winRate}%`, icon: 'progress' }, { label: 'Current streak', value: t(data.streak === 1 ? '{0} day' : '{0} days', data.streak), icon: 'sun' }, { label: 'Words solved', value: data.wins, icon: 'check' }] satisfies { label: string; value: string | number; icon: IconName }[]).map(({ label, value, icon }) => <article key={label}><span className="stat-label"><span>{t(label)}</span><Icon name={icon} /></span><strong>{value}</strong></article>)}</div>
      <div className="statistics-columns">
        <article className="statistics-card recent-practice"><div className="practice-history-heading"><h3>{t('Recent practice')}</h3><span>{t('{0} games', data.total.toLocaleString())}</span></div>
          {data.totalPages > 1 && <nav className="history-pagination" aria-label={t('Recent practice pages')}><button type="button" disabled={loading || data.page <= 1} onClick={() => setPage(data.page - 1)}>{t('Previous')}</button><span>{t('Page {0} of {1}', data.page, data.totalPages)}</span><button type="button" disabled={loading || data.page >= data.totalPages} onClick={() => setPage(data.page + 1)}>{t('Next')}</button></nav>}
          {!loading && <div className="practice-table-scroll"><table className="recent-practice-table"><thead><tr><th scope="col">{t('Word')}</th><th scope="col">{t('Practice')}</th><th scope="col">{t('Result')}</th><th scope="col"><span className="sr-only">{t('Save word')}</span></th></tr></thead><tbody>{data.recent.map(game => {
            const saved = selection.saved.has(game.answer), pending = selection.pending.has(game.answer);
            return <tr key={game.id}><td><span className="word-with-pronunciation"><strong>{game.answer}</strong><PronunciationButton term={game.answer}/></span>{game.answerDefinition && <p className="recent-word-definition">{game.answerDefinition}</p>}</td><td><span>{t('{0} letters · {1} · {2} guesses', game.wordLength, t(game.difficulty), game.attemptCount)}</span><time dateTime={game.completedAt}>{new Date(game.completedAt).toLocaleDateString(language)}</time></td><td><span className={`result-badge ${game.status === 'won' ? 'won' : ''}`}>{game.status === 'won' ? t('Solved') : t('Practised')}</span></td><td><button type="button" className="bookmark-button" aria-label={saved ? t('{0} is already in your word list', game.answer) : pending ? t('Cancel addition of {0}', game.answer) : t('Add {0} to word list', game.answer)} aria-pressed={pending} disabled={saved || selection.saving || !selection.ready} onClick={() => store.toggle(game.answer, game.answerDefinition ?? '')}><Icon name={saved || pending ? 'check' : 'plus'}/><span>{saved ? t('Saved') : pending ? t('Selected') : t('Add')}</span></button></td></tr>;
          })}</tbody></table></div>}
        </article>
      </div>
      <p className="statistics-footnote">{t('Streaks count days with a completed puzzle in {0}. Today’s streak stays active if you practised yesterday.', data.timezone)}</p>
    </>}
  </section>;
}
