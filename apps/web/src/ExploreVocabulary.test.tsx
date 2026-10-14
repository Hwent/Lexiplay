import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import ExploreVocabulary from './ExploreVocabulary';
const collection={id:'c-a2',slug:'cefr-a2',name:'CEFR A2',description:'Vocabulary for A2.',category:'CEFR',level:'A2',author:'oxford_3000_5000',source:'Supplied Oxford source',license:null,version:'v1',status:'available',wordCount:2};
const word={id:'word-cover',lemma:'cover',partOfSpeech:'verb',stage:'Core',definition:'To place over.',language:'en',definitionSource:'dictionary'};
const page={collection,page:1,pageSize:25,total:2,partsOfSpeech:['verb'],stages:['Foundation','Core','Advanced'],words:[word]};
afterEach(()=>{cleanup();vi.unstubAllGlobals();history.replaceState({},'','/');});
it('browses, selects a word, previews duplicate skipping and imports only the selected identity',async()=>{
  const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const path=String(input);
    if(path.endsWith('/collections'))return Response.json([collection]);
    if(path.includes('/collections/cefr-a2/words?'))return Response.json(page);
    if(path.endsWith('/word-lists/mine'))return Response.json([{id:'my-list',name:'Study words',preferredLanguage:'zh'}]);
    return Response.json({success:true,totalRequested:1,added:0,skipped:1,failed:0});
  });vi.stubGlobal('fetch',fetchMock);const user=userEvent.setup();const onImported=vi.fn();
  render(<ExploreVocabulary signedIn onImported={onImported} onSignIn={()=>{}}/>);
  await user.click(await screen.findByRole('button',{name:'Explore CEFR A2'}));
  await user.click(await screen.findByRole('checkbox',{name:'Select cover (verb)'}));
  await user.click(screen.getByRole('button',{name:'Add selected (1)'}));
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  await waitFor(()=>expect(screen.getByRole('button',{name:'Preview import'})).toBeEnabled());
  await user.click(screen.getByRole('button',{name:'Preview import'}));
  expect(await screen.findByText('1 requested · 0 to add · 1 duplicates to skip')).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([input])=>String(input).endsWith('/import-collection'))).toBe(false);
  await user.click(screen.getByRole('button',{name:'Confirm import'}));
  expect(await screen.findByText('0 added · 1 duplicates skipped · 0 failed')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/word-lists/my-list/import-collection',expect.objectContaining({body:JSON.stringify({collectionId:'cefr-a2',selectedWordIds:['word-cover'],duplicatePolicy:'skip'})}));
  await user.click(screen.getByRole('button',{name:'Open word list'}));expect(onImported).toHaveBeenCalledWith('my-list');
});
it('saves an official collection by reference without creating a personal list or copying words',async()=>{
  const fetchMock=vi.fn(async(input:RequestInfo|URL)=>{const path=String(input);if(path.endsWith('/word-lists/collections'))return Response.json([]);if(path.endsWith('/collections'))return Response.json([collection]);if(path.includes('/collections/cefr-a2/words?'))return Response.json(page);return Response.json({success:true});});
  vi.stubGlobal('fetch',fetchMock);const user=userEvent.setup();render(<ExploreVocabulary signedIn onImported={()=>{}} onSignIn={()=>{}}/>);
  await user.click(await screen.findByRole('button',{name:'Explore CEFR A2'}));await user.click(await screen.findByRole('button',{name:'Save official collection'}));
  expect(await screen.findByRole('button',{name:'Collection saved'})).toBeDisabled();
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/collections/cefr-a2/save',expect.objectContaining({method:'POST'}));
  expect(fetchMock.mock.calls.some(([input])=>String(input).includes('/import-collection'))).toBe(false);
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});
it('keeps missing exam data explicit instead of inventing counts or mapping exam stages to CEFR',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json([{...collection,id:'ielts',slug:'ielts-core',name:'IELTS Core Vocabulary',category:'IELTS',level:null,wordCount:0,status:'awaiting_data'}])));
  render(<ExploreVocabulary signedIn={false} onImported={()=>{}} onSignIn={()=>{}}/>);
  expect(await screen.findByText('Awaiting source data')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Explore IELTS Core Vocabulary'})).toBeDisabled();
});
