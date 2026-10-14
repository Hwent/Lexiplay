import { expect,it,vi } from 'vitest';
import { CollectionCache,CollectionStorage,collectionPage } from './collection-cache';
import { CollectionPage } from '../collection-types';
const collection={id:'a',slug:'cefr-a1',name:'CEFR A1',description:'',category:'CEFR',level:'A1',author:'test',source:null,license:null,version:'v1',status:'available',wordCount:2,familyCount:1};
const snapshot:CollectionPage={collection,page:1,pageSize:1,total:1,pageUnit:'family',partsOfSpeech:['noun'],stages:['Core'],families:[{id:'act',headword:'act',kind:'family',memberIds:['action','actor'],relatedMembers:[]}],words:['action','actor'].map(id=>({id,lemma:id,partOfSpeech:'noun',stage:'Core',definition:'Meaning.',language:'en',definitionSource:'dictionary',inMyWordList:true}))};
function disk(){const values=new Map<string,Awaited<ReturnType<CollectionStorage['read']>>>();return {read:async(key:string)=>values.get(key),write:async(key:string,value:NonNullable<Awaited<ReturnType<CollectionStorage['read']>>>)=>{values.set(key,value);}};}
it('persists a complete public collection across cache instances and overlays account membership only in memory',async()=>{
  const storage=disk(),fetch=vi.fn(async()=>snapshot),first=new CollectionCache(storage,fetch);
  const [a,b]=await Promise.all([first.load(collection),first.load(collection)]);
  expect(fetch).toHaveBeenCalledTimes(1);expect(a).toEqual(b);expect(a.stored).toBe(true);
  expect(a.data.words.every(word=>word.inMyWordList===undefined)).toBe(true);
  const next=new CollectionCache(storage,vi.fn(()=>Promise.reject(new Error('No network needed'))));
  const local=await next.load(collection);expect(local.data.words).toHaveLength(2);
  expect(collectionPage(local.data,1,25,new Set(['actor'])).words.map(word=>word.inMyWordList)).toEqual([false,true]);
  expect(collectionPage(local.data,1,25,new Set()).words.every(word=>!word.inMyWordList)).toBe(true);
});
it('refreshes changed source versions, rejects incomplete downloads, and reports storage failure honestly',async()=>{
  const storage=disk(),fetch=vi.fn(async()=>snapshot),cache=new CollectionCache(storage,fetch);await cache.load(collection);
  const updated={...collection,version:'v2'};fetch.mockResolvedValue({...snapshot,collection:updated});await cache.load(updated);expect(fetch).toHaveBeenCalledTimes(2);
  const bad=new CollectionCache(disk(),async()=>({...snapshot,total:2}));await expect(bad.load(collection)).rejects.toThrow('complete collection');
  const unavailable=new CollectionCache({read:async()=>undefined,write:async()=>{throw new Error('Storage full');}},async()=>snapshot);
  expect((await unavailable.load(collection)).stored).toBe(false);
});
