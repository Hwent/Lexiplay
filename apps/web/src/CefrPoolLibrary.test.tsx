import App from './App';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import CefrPoolLibrary, { CefrPoolPicker } from './CefrPoolLibrary';
const summary = { id: 'oxford-a2', name: 'Oxford A2', level: 'A2', author: 'oxford_3000_5000', wordCount: 1 };
const details = { ...summary, availableCount: 1, wordCounts: { 5: 1 }, words: [{ term: 'cover', partsOfSpeech: ['verb'], definition: 'To place over something.', available: true, senses: [{ partOfSpeech: 'verb', definitions: ['To place over something.'] }] }] };
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
it('offers every available collection without requiring a saved subscription',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json([summary,{...summary,id:'lexiplay-c2',name:'C2 Advanced',level:'C2'}])));
  const onChange=vi.fn(),user=userEvent.setup();render(<CefrPoolPicker signedIn={false} disabled={false} value="" onChange={onChange} onOpenLibrary={()=>{}}/>);
  await screen.findByRole('option',{name:'C2 Advanced'});
  await user.selectOptions(screen.getByLabelText('CEFR gaming pool'),'lexiplay-c2');
  expect(onChange).toHaveBeenCalledWith('lexiplay-c2');
  expect(localStorage.getItem('lexiplay-added-cefr-pools')).toBeNull();
});
it('accepts the C2 collection as a saved game pool without an Oxford identifier',async()=>{
  localStorage.setItem('lexiplay-added-cefr-pools',JSON.stringify([{...summary,id:'lexiplay-c2',name:'C2 Advanced',level:'C2',author:'LexiPlay; Octanove Labs'}]));
  const onChange=vi.fn();const user=userEvent.setup();
  render(<CefrPoolPicker signedIn={false} disabled={false} value="" onChange={onChange} onOpenLibrary={()=>{}}/>);
  await user.selectOptions(screen.getByLabelText('CEFR gaming pool'),'lexiplay-c2');
  expect(onChange).toHaveBeenCalledWith('lexiplay-c2');
});
it('keeps catalog definition-free until a guest adds a list and then resolves matching dictionary senses', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => Response.json(String(input).endsWith('/pools') ? [summary] : details));
  vi.stubGlobal('fetch',fetchMock);
  const user = userEvent.setup();
  render(<CefrPoolLibrary signedIn={false} />);
  const add = await screen.findByRole('button',{ name:'Add Oxford A2' });
  expect(screen.queryByText('To place over something.')).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await user.click(add);
  const pool = await screen.findByRole('region',{name:'Oxford A2 words'});
  expect(within(pool).getByText('To place over something.')).toBeInTheDocument();
  expect(within(pool).getByText('verb')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Open Oxford A2'})).toBeInTheDocument();
  const saved=JSON.parse(localStorage.getItem('lexiplay-added-cefr-pools')!);
  expect(saved).toEqual([summary]);
});
it('persists a signed-in user addition through the list subscription endpoint', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => Response.json(String(input).endsWith('/added') ? [] : init?.method==='POST' ? details : [summary]));
  vi.stubGlobal('fetch',fetchMock);
  const user=userEvent.setup();render(<CefrPoolLibrary signedIn />);
  await user.click(await screen.findByRole('button',{name:'Add Oxford A2'}));
  await screen.findByRole('region',{name:'Oxford A2 words'});
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/word-lists/pools/oxford-a2',expect.objectContaining({method:'POST'}));
});
it('offers added pools for gameplay without loading their definitions',async()=>{
  localStorage.setItem('lexiplay-added-cefr-pools',JSON.stringify([summary]));
  const onChange=vi.fn();const user=userEvent.setup();
  render(<CefrPoolPicker signedIn={false} disabled={false} value="" onChange={onChange} onOpenLibrary={()=>{}} />);
  await user.selectOptions(screen.getByLabelText('CEFR gaming pool'),'oxford-a2');
  expect(onChange).toHaveBeenCalledWith('oxford-a2');
});

it('starts a game using the selected added CEFR pool', async () => {
  window.history.replaceState({}, '', '/games');
  localStorage.setItem('lexiplay-added-cefr-pools', JSON.stringify([summary]));
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/auth/me')) return new Response('{}', { status: 401 });
    return Response.json({ id: 'cefr-game', wordLength: 5, difficulty: 'medium', attemptLimit: 6, guesses: [], hints: { unused: 2, present: 2 }, revealedAbsent: [], revealedPresent: [], pool: summary });
  });
  vi.stubGlobal('fetch', fetchMock);
  const user = userEvent.setup();
  render(<App />);
  await user.selectOptions(screen.getByLabelText('CEFR gaming pool'), 'oxford-a2');
  await user.click(screen.getByRole('button', { name: /Start practice/ }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/games', expect.objectContaining({ body: JSON.stringify({kind:'word-puzzle',wordLength:5,difficulty:'medium',playWithMyWords:false,poolId:'oxford-a2'}) })));
  expect(await screen.findByText('Oxford A2 · oxford_3000_5000')).toBeInTheDocument();
  window.history.replaceState({}, '', '/');
});
