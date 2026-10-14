import { useEffect, useState } from 'react';
import { apiRequest as api } from './services/api-client';
import PronunciationButton from './PronunciationButton';

type PoolSummary = { id: string; name: string; level: string; author: string; wordCount: number };
type PoolWord = { term: string; partsOfSpeech: string[]; definition: string; available: boolean; senses: { partOfSpeech: string; definitions: string[] }[] };
type PoolDetails = PoolSummary & { words: PoolWord[]; availableCount: number; wordCounts: Record<string, number> };
const POOLS_KEY = 'lexiplay-added-cefr-pools';
const POOLS_EVENT = 'lexiplay:cefr-pools-changed';
const validPool = (pool: PoolSummary) => !!pool && /^(?:oxford-(?:a1|a2|b1|b2|c1)|lexiplay-c2)$/.test(pool.id) && typeof pool.name === 'string' && typeof pool.author === 'string' && Number.isInteger(pool.wordCount);
function savedPools(): PoolSummary[] {
  try {
    const pools: unknown = JSON.parse(localStorage.getItem(POOLS_KEY) ?? '[]');
    return Array.isArray(pools) ? pools.filter(validPool) : [];
  } catch { return []; }
}
function rememberPools(pools: PoolSummary[]) {
  try { localStorage.setItem(POOLS_KEY, JSON.stringify(pools)); } catch { /* The current view remains usable without storage. */ }
  window.dispatchEvent(new Event(POOLS_EVENT));
}

export default function CefrPoolLibrary({ signedIn }: { signedIn: boolean }) {
  const [catalog, setCatalog] = useState<PoolSummary[]>([]);
  const [added, setAdded] = useState<PoolSummary[]>(savedPools);
  const [details, setDetails] = useState<PoolDetails | null>(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    Promise.all([api<PoolSummary[]>('/word-lists/pools'), signedIn ? api<PoolSummary[]>('/word-lists/pools/added') : Promise.resolve(savedPools())])
      .then(([catalog, added]) => {
        if (!active) return;
        if (!Array.isArray(catalog) || !Array.isArray(added) || !catalog.every(validPool) || !added.every(validPool)) throw new Error('Could not load CEFR lists.');
        setCatalog(catalog); setAdded(added); rememberPools(added);
      }).catch(error => { if (active) setError(error instanceof Error ? error.message : 'Could not load CEFR lists.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [signedIn, revision]);
  async function open(pool: PoolSummary, adding: boolean) {
    setBusy(pool.id); setError('');
    try {
      const details = await api<PoolDetails>(`/word-lists/pools/${pool.id}`, adding && signedIn ? { method: 'POST' } : undefined);
      setDetails(details); setPage(1);
      if (adding) {
        const next = [...added.filter(item => item.id !== pool.id), pool];
        setAdded(next); rememberPools(next);
      }
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not open this list.'); }
    finally { setBusy(''); }
  }
  const visible = details?.words.slice((page - 1) * 20, page * 20) ?? [];
  return <section className="cefr-library" aria-label="CEFR gaming pools">
    <div className="section-intro"><div><p className="eyebrow">CEFR WORD LISTS</p><h2>Choose a gaming pool</h2><p>Add an Oxford level to use it in practice. Definitions come from your dictionary when you open the list.</p></div></div>
    {loading && <p role="status">Loading CEFR lists…</p>}
    {error && <p role="alert">{error} <button type="button" onClick={() => setRevision(value => value + 1)}>Retry</button></p>}
    <div className="cefr-pool-grid">{catalog.map(pool => {
      const isAdded = added.some(item => item.id === pool.id);
      return <article className="cefr-pool-card" key={pool.id}><span className="eyebrow">{pool.level}</span><h3>{pool.name}</h3><p>{pool.wordCount.toLocaleString()} words</p><small>By {pool.author}</small><button type="button" className="account-action" disabled={!!busy} onClick={() => void open(pool, !isAdded)} aria-label={`${isAdded ? 'Open' : 'Add'} ${pool.name}`}>{busy === pool.id ? 'Loading…' : isAdded ? 'Open list' : 'Add list'}</button></article>;
    })}</div>
    {details && <section className="cefr-pool-details" aria-label={`${details.name} words`}><div className="cefr-pool-heading"><div><h3>{details.name}</h3><p>By {details.author} · {details.words.length} words · {details.availableCount} with matching dictionary senses</p></div><button type="button" onClick={() => setDetails(null)}>Close list</button></div>
      <ul className="word-entry-list">{visible.map(word => <li key={word.term}><span><span className="word-with-pronunciation"><strong>{word.term}</strong><PronunciationButton term={word.term} /></span>{word.senses.length ? word.senses.map(sense => <span className="cefr-word-sense" key={sense.partOfSpeech}><small>{sense.partOfSpeech}</small>{sense.definitions.join('; ')}</span>) : <small>{word.partsOfSpeech.join(', ')} · No matching dictionary definition yet.</small>}</span></li>)}</ul>
      <nav className="word-pagination" aria-label="CEFR list pages"><button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page} of {Math.ceil(details.words.length / 20)}</span><button type="button" disabled={page * 20 >= details.words.length} onClick={() => setPage(value => value + 1)}>Next</button></nav>
    </section>}
  </section>;
}

export function CefrPoolPicker({ signedIn, value, disabled, onChange, onOpenLibrary }: { signedIn: boolean; value: string; disabled: boolean; onChange: (id: string) => void; onOpenLibrary: () => void }) {
  const [added, setAdded] = useState<PoolSummary[]>(savedPools);
  const [catalog,setCatalog]=useState<PoolSummary[]>([]);
  useEffect(() => {
    let active = true;
    api<PoolSummary[]>('/word-lists/pools').then(pools=>{if(active&&Array.isArray(pools)&&pools.every(validPool))setCatalog(pools);}).catch(()=>{});
    const update = () => setAdded(savedPools());
    window.addEventListener(POOLS_EVENT, update);
    if (signedIn) api<PoolSummary[]>('/word-lists/pools/added').then(pools => {
      if (active && Array.isArray(pools) && pools.every(validPool)) { setAdded(pools); rememberPools(pools); }
    }).catch(() => { /* Added lists already cached on this device remain available. */ });
    return () => { active = false; window.removeEventListener(POOLS_EVENT, update); };
  }, [signedIn]);
  const available=[...new Map([...added,...catalog].map(pool=>[pool.id,pool])).values()];
  return <div className="cefr-pool-picker">{available.length > 0 && <><label htmlFor="cefr-pool">CEFR gaming pool</label><select id="cefr-pool" value={value} disabled={disabled} onChange={event => onChange(event.target.value)}><option value="">No CEFR pool selected</option>{available.map(pool => <option value={pool.id} key={pool.id}>{pool.name}</option>)}</select></>}<button type="button" className="text-action" onClick={onOpenLibrary}>Browse CEFR collections</button></div>;
}
