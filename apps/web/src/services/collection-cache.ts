import { CollectionPage, VocabularyCollection } from '../collection-types';
import { apiRequest } from './api-client';
type Cached = { version:string; expiresAt:number; data:CollectionPage };
export type CollectionStorage = { read:(key:string)=>Promise<Cached|undefined>; write:(key:string,value:Cached)=>Promise<void> };
const lifetime=24*60*60*1000;
function storage():CollectionStorage {
  let opening:Promise<IDBDatabase>|undefined;
  const database=()=>opening??=(new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open('lexiplay-public-collections-v1',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('snapshots');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Local collection storage is busy.'));
  }));
  async function read(key:string){
    if(typeof indexedDB==='undefined'){const text=localStorage.getItem('lexiplay-collection:'+key);return text?JSON.parse(text):undefined;}
    const db=await database();return new Promise<Cached|undefined>((resolve,reject)=>{const request=db.transaction('snapshots').objectStore('snapshots').get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  }
  async function write(key:string,value:Cached){
    if(typeof indexedDB==='undefined'){localStorage.setItem('lexiplay-collection:'+key,JSON.stringify(value));return;}
    const db=await database();return new Promise<void>((resolve,reject)=>{const transaction=db.transaction('snapshots','readwrite');transaction.objectStore('snapshots').put(value,key);transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);});
  }
  return {read,write};
}
export class CollectionCache {
  private pending=new Map<string,Promise<{data:CollectionPage;stored:boolean}>>();
  constructor(private disk:CollectionStorage=storage(),private fetchSnapshot=(slug:string)=>apiRequest<CollectionPage>(`/collections/${encodeURIComponent(slug)}/snapshot`)){}
  load(collection:VocabularyCollection,refresh=false){
    const key=collection.slug+'@'+collection.version, active=this.pending.get(key);if(active)return active;
    const request=(async()=>{
      const cached=await this.disk.read(collection.slug).catch(()=>undefined);
      if(!refresh && cached?.version===collection.version && cached.expiresAt>Date.now() && valid(cached.data,collection))return {data:cached.data,stored:true};
      const response=await this.fetchSnapshot(collection.slug);
      if(!valid(response,collection))throw new Error('Could not load the complete collection.');
      const data:CollectionPage={...response,words:response.words.map(({inMyWordList,...word})=>word)};
      let stored=true;await this.disk.write(collection.slug,{version:collection.version,expiresAt:Date.now()+lifetime,data}).catch(()=>{stored=false;});
      return {data,stored};
    })().finally(()=>{if(this.pending.get(key)===request)this.pending.delete(key);});
    this.pending.set(key,request);return request;
  }
}
function valid(data:CollectionPage,collection:VocabularyCollection){
  if(data?.collection?.slug!==collection.slug||data.collection.version!==collection.version||!Array.isArray(data.words)||!Array.isArray(data.families)||data.families.length!==data.total||data.words.length!==collection.wordCount)return false;
  const ids=new Set(data.words.map(word=>word?.id));
  if(ids.size!==data.words.length||!data.words.every(word=>typeof word?.id==='string'&&typeof word.lemma==='string'&&typeof word.partOfSpeech==='string'&&(word.definition===null||typeof word.definition==='string')))return false;
  const assigned=new Set<string>();
  for(const family of data.families){
    if(typeof family?.id!=='string'||typeof family.headword!=='string'||!['family','phrase','unclassified'].includes(family.kind)||!Array.isArray(family.memberIds)||!Array.isArray(family.relatedMembers))return false;
    for(const id of family.memberIds){if(!ids.has(id)||assigned.has(id))return false;assigned.add(id);}
  }
  return assigned.size===ids.size;
}
export const collectionCache=new CollectionCache();
export function collectionPage(snapshot:CollectionPage,page:number,pageSize=25,savedIds:ReadonlySet<string>=new Set()):CollectionPage {
  const families=snapshot.families!.slice((page-1)*pageSize,page*pageSize), ids=new Set(families.flatMap(family=>family.memberIds));
  return {...snapshot,page,pageSize,families,words:snapshot.words.filter(word=>ids.has(word.id)).map(word=>({...word,inMyWordList:savedIds.has(word.id)}))};
}
