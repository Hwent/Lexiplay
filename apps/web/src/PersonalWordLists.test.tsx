import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import PersonalWordLists from './PersonalWordLists';
const list={id:'list-1',name:'Academic words',isDefault:false,preferredLanguage:'zh',wordCount:1};
const word={id:'entry-1',dictionaryEntryId:'word-1',lemma:'analyse',partOfSpeech:'verb',stage:'Core',definition:'分析一下问题',language:'zh',definitionSource:'custom',customDefinition:'分析一下问题',customLanguage:'zh',familiarity:4,nextReviewAt:'2030-01-01T12:00:00.000Z'};
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('edits a private definition and language without changing review settings or the global dictionary',async()=>{
  const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{if(String(input).endsWith('/mine'))return Response.json([list]);if(init?.method==='PATCH')return Response.json({success:true});return Response.json({list,page:1,pageSize:25,total:1,words:[word]});});
  vi.stubGlobal('fetch',fetchMock);const user=userEvent.setup();render(<PersonalWordLists signedIn searchQuery="" initialId="list-1" revision={0}/>);
  await screen.findByText('分析一下问题');await waitFor(()=>expect(screen.getByRole('button',{name:'Edit definition'})).toBeEnabled());await user.click(screen.getByRole('button',{name:'Edit definition'}));
  expect(screen.getByLabelText('Your definition')).toHaveValue('分析一下问题');expect(screen.getByLabelText('Your definition language')).toHaveValue('zh');
  await user.clear(screen.getByLabelText('Your definition'));await user.type(screen.getByLabelText('Your definition'),'我的分析笔记');await user.click(screen.getByRole('button',{name:'Save definition'}));
  await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith('/api/v1/word-lists/list-1/entries/entry-1',expect.objectContaining({method:'PATCH',body:JSON.stringify({customDefinition:'我的分析笔记',customLanguage:'zh'})})));
  expect(fetchMock.mock.calls.some(([path])=>String(path).includes('/dictionary'))).toBe(false);
});
it('records a personal review without list filter controls',async()=>{
  const fetchMock=vi.fn(async(input:RequestInfo|URL,_init?:RequestInit)=>Response.json(String(input).endsWith('/mine')?[list]:{list,page:1,pageSize:25,total:1,words:[word]}));vi.stubGlobal('fetch',fetchMock);
  const user=userEvent.setup();render(<PersonalWordLists signedIn searchQuery="" initialId="list-1" revision={0}/>);await screen.findByText('分析一下问题');await waitFor(()=>expect(screen.getByRole('button',{name:'Reviewed'})).toBeEnabled());await user.click(screen.getByRole('button',{name:'Reviewed'}));
  await waitFor(()=>expect(fetchMock.mock.calls.some(([,init])=>init?.method==='PATCH')).toBe(true));
  const patch=fetchMock.mock.calls.find(([,init])=>init?.method==='PATCH')!;expect(JSON.parse(String(patch[1]?.body))).toMatchObject({familiarity:5,nextReviewAt:expect.any(String)});
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();expect(screen.queryByRole('checkbox',{name:'Due for review'})).not.toBeInTheDocument();
});
