import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import ExploreVocabulary from './ExploreVocabulary';
const collection={id:'c-a2',slug:'cefr-a2',name:'CEFR A2',description:'Vocabulary for A2.',category:'CEFR',level:'A2',author:'oxford_3000_5000',source:'Supplied Oxford source',license:null,version:'v1',status:'available',wordCount:2};
const word={id:'word-cover',lemma:'cover',partOfSpeech:'verb',stage:'Core',definition:'To place over.',language:'en',definitionSource:'dictionary'};
const page={collection,page:1,pageSize:25,total:2,partsOfSpeech:['verb'],stages:['Foundation','Core','Advanced'],words:[word]};
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals();history.replaceState({},'','/');});
it('selects family members independently, keeps selections across family pages and preserves related level labels',async()=>{
  const familyCollection={...collection,level:'A1',slug:'cefr-a1',name:'CEFR A1',wordCount:27,familyCount:26,otherUnitCount:0};
  const action={...word,id:'action',lemma:'action',partOfSpeech:'noun'},actor={...word,id:'actor',lemma:'actor',partOfSpeech:'noun'};
  const fetchMock=vi.fn(async(input:RequestInfo|URL)=>{
    const path=String(input);
    if(path.endsWith('/snapshot')){
      const others=Array.from({length:24},(_,i)=>({id:'extra-'+i,headword:'extra-'+i,kind:'family',memberIds:['extra-'+i],relatedMembers:[]}));
      return Response.json({...page,collection:familyCollection,page:1,pageSize:26,total:26,pageUnit:'family',memberTotal:27,
        words:[action,actor,...others.map(family=>({...word,id:family.id,lemma:family.headword})),{...word,id:'able',lemma:'able',partOfSpeech:'adjective'}],
        families:[{id:'family-act',headword:'act',kind:'family',memberIds:['action','actor'],relatedMembers:[{lemma:'act',partsOfSpeech:['verb'],level:'A2'}]},...others,{id:'family-able',headword:'able',kind:'family',memberIds:['able'],relatedMembers:[]}]});
    }
    return Response.json([familyCollection]);
  });
  vi.stubGlobal('fetch',fetchMock);const user=userEvent.setup();render(<ExploreVocabulary signedIn={false} onImported={()=>{}} onSignIn={()=>{}}/>);
  await screen.findByRole('cell', { name: '27' });
  expect(screen.queryByText(/26 families|27 members/)).not.toBeInTheDocument();
  await user.click(await screen.findByRole('button',{name:'Explore CEFR A1'}));
  await user.click(await screen.findByRole('checkbox',{name:'Select act family members'}));
  expect(screen.getByRole('checkbox',{name:'Select action (noun)'})).toBeChecked();
  expect(screen.getByRole('checkbox',{name:'Select actor (noun)'})).toBeChecked();
  expect(screen.getByText('2 selected across pages')).toBeInTheDocument();
  await user.click(screen.getByText('Related members at other levels (1)'));
  expect(screen.queryByText('verb · A2')).not.toBeInTheDocument();
  await user.click(screen.getByRole('checkbox',{name:'Select actor (noun)'}));
  expect(screen.getByRole('checkbox',{name:'Select act family members'})).not.toBeChecked();
  await user.click(screen.getAllByRole('button',{name:'Next'})[0]!);
  expect(screen.queryByRole('checkbox',{name:'Select action (noun)'})).not.toBeInTheDocument();
  await user.click(await screen.findByRole('checkbox',{name:'Select able family members'}));
  expect(screen.getByText('2 selected across pages')).toBeInTheDocument();
  expect(fetchMock.mock.calls.filter(([input])=>String(input).endsWith('/snapshot'))).toHaveLength(1);
});
it('browses, selects a word, previews duplicate skipping and imports only the selected identity',async()=>{
  const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const path=String(input);
    if(path.endsWith('/collections'))return Response.json([collection]);
    if(path.includes('/collections/cefr-a2/words?'))return Response.json(page);
    if(path.endsWith('/word-lists/mine'))return Response.json([{id:'my-list',name:'Study words',preferredLanguage:'zh'}]);
    return Response.json({success:true,totalRequested:1,added:1,skipped:0,failed:0});
  });vi.stubGlobal('fetch',fetchMock);const user=userEvent.setup();const onImported=vi.fn();
  render(<ExploreVocabulary signedIn onImported={onImported} onSignIn={()=>{}}/>);
  await user.click(await screen.findByRole('button',{name:'Explore CEFR A2'}));
  await user.click(await screen.findByRole('checkbox',{name:'Select cover (verb)'}));
  await user.click(screen.getByRole('button',{name:'Add to My Word List (1)'}));
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(await screen.findByText('1 new word will be added.')).toBeInTheDocument();
  expect(screen.queryByText(/Destination:/)).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Cancel'})).toBeEnabled();
  expect(fetchMock.mock.calls.some(([input])=>String(input).endsWith('/import-collection'))).toBe(false);
  await user.click(screen.getByRole('button',{name:'Add to My Word List'}));
  expect(await screen.findByText('1 word added.')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Done'})).toBeEnabled();
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/word-lists/my-list/import-collection',expect.objectContaining({body:JSON.stringify({collectionId:'cefr-a2',selectedWordIds:['word-cover'],duplicatePolicy:'skip'})}));
  await user.click(screen.getByRole('button',{name:'Open My Word List'}));expect(onImported).toHaveBeenCalledWith('my-list');
});
it('saves an official collection by reference without creating a personal list or copying words',async()=>{
  const fetchMock=vi.fn(async(input:RequestInfo|URL)=>{const path=String(input);if(path.endsWith('/word-lists/collections'))return Response.json([]);if(path.endsWith('/collections'))return Response.json([collection]);if(path.includes('/collections/cefr-a2/words?'))return Response.json(page);return Response.json({success:true});});
  vi.stubGlobal('fetch',fetchMock);const user=userEvent.setup();render(<ExploreVocabulary signedIn onImported={()=>{}} onSignIn={()=>{}}/>);
  await user.click(await screen.findByRole('button',{name:'Explore CEFR A2'}));await user.click(await screen.findByRole('button',{name:'Save collection'}));
  expect(await screen.findByRole('button',{name:'Collection saved'})).toBeDisabled();
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/collections/cefr-a2/save',expect.objectContaining({method:'POST'}));
  expect(fetchMock.mock.calls.some(([input])=>String(input).includes('/import-collection'))).toBe(false);
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});
it('keeps missing exam data explicit instead of inventing counts or mapping exam stages to CEFR',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json([{...collection,id:'ielts',slug:'ielts-core',name:'IELTS Core Vocabulary',category:'IELTS',level:null,wordCount:0,status:'awaiting_data'}])));
  render(<ExploreVocabulary signedIn={false} onImported={()=>{}} onSignIn={()=>{}}/>);
  expect((await screen.findAllByText('Coming soon')).length).toBeGreaterThan(0);expect(screen.getByRole('button',{name:'Explore IELTS Core Vocabulary'})).toBeDisabled();
});

it('keeps pagination visible, selections across pages and saved-word status without exposing metadata',async()=>{
  const fetchMock=vi.fn(async(input:RequestInfo|URL)=>{const url=String(input);if(url.endsWith('/word-lists/collections'))return Response.json([]);if(url.includes('/words?')){const second=url.includes('page=2&');return Response.json({...page,total:898,words:second?[{...word,id:'word-next',lemma:'next'}]:[word,{...word,id:'already',lemma:'added',inMyWordList:true}]});}return Response.json([collection]);});
  vi.stubGlobal('fetch',fetchMock);const user=userEvent.setup();render(<ExploreVocabulary signedIn onImported={()=>{}} onSignIn={()=>{}}/>);
  expect(await screen.findByRole('button',{name:'Explore CEFR A2'})).toBeInTheDocument();
  expect(screen.queryByText(/oxford_3000_5000/)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Explore CEFR A2'}));
  await screen.findByText('In My Word List');expect(screen.getByRole('checkbox',{name:'Select added (verb)'})).toBeDisabled();
  expect(screen.getAllByText('Page 1 of 36 · 898 words')).toHaveLength(2);
  expect(screen.queryByText(/License:|Version:|Supplied Oxford/)).not.toBeInTheDocument();
  await user.click(screen.getByRole('checkbox',{name:'Select cover (verb)'}));
  await user.click(screen.getAllByRole('button',{name:'Next'})[0]!);
  expect(screen.queryByRole('checkbox',{name:'Select cover (verb)'})).not.toBeInTheDocument();
  await screen.findByRole('checkbox',{name:'Select next (verb)'});
  await user.click(screen.getByRole('checkbox',{name:'Select next (verb)'}));
  expect(screen.getByText('2 selected across pages')).toBeInTheDocument();
  expect(screen.getAllByText('Page 2 of 36 · 898 words')).toHaveLength(2);
});

it('lets users cancel the preview without writing and explains when all words are already saved',async()=>{
  const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const url=String(input);if(url.endsWith('/word-lists/collections'))return Response.json([]);if(url.endsWith('/collections'))return Response.json([collection]);if(url.includes('/words?'))return Response.json(page);if(url.endsWith('/mine'))return Response.json([{id:'my-list',isDefault:true}]);return Response.json({success:true,totalRequested:1,added:0,skipped:1,failed:0});});
  vi.stubGlobal('fetch',fetchMock);const user=userEvent.setup();render(<ExploreVocabulary signedIn onImported={()=>{}} onSignIn={()=>{}}/>);
  await user.click(await screen.findByRole('button',{name:'Explore CEFR A2'}));await user.click(await screen.findByRole('checkbox',{name:'Select cover (verb)'}));await user.click(screen.getByRole('button',{name:'Add to My Word List (1)'}));
  await screen.findByText('All selected words are already in your list.');expect(screen.getByRole('button',{name:'Add to My Word List'})).toBeDisabled();
  await user.click(screen.getByRole('button',{name:'Cancel'}));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByText('1 selected across pages')).toBeInTheDocument();expect(fetchMock.mock.calls.some(([url])=>String(url).endsWith('/import-collection'))).toBe(false);
});
