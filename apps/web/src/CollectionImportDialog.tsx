import { useEffect, useRef, useState } from 'react';
import { apiRequest as api } from './services/api-client';
import { ImportSummary, PersonalList, VocabularyCollection } from './collection-types';
export default function CollectionImportDialog({collection,selectedIds,signedIn,onClose,onImported,onSignIn}:{collection:VocabularyCollection;selectedIds:string[]|undefined;signedIn:boolean;onClose:()=>void;onImported:(id:string)=>void;onSignIn:()=>void}) {
  const [target,setTarget]=useState('');
  const [preview,setPreview]=useState<ImportSummary|null>(null),[result,setResult]=useState<ImportSummary|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const dialog=useRef<HTMLDivElement>(null);
  useEffect(()=>{const previous=document.activeElement;dialog.current?.querySelector<HTMLElement>('select,input,button')?.focus();return()=>{if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};},[]);
  useEffect(()=>{let active=true;if(signedIn)api<PersonalList[]>('/word-lists/mine').then(lists=>{if(active&&Array.isArray(lists)){const overall=lists.find(list=>list.isDefault)||lists[0];if(overall)setTarget(overall.id);}}).catch(error=>{if(active)setError(error instanceof Error?error.message:'Could not load word lists.');});return()=>{active=false;};},[signedIn]);
  const payload={collectionId:collection.slug,...(selectedIds!==undefined?{selectedWordIds:selectedIds}:{}),duplicatePolicy:'skip'};
  async function check(){setBusy(true);setError('');try{setPreview(await api<ImportSummary>(`/word-lists/${target}/import-collection/preview`,{method:'POST',body:JSON.stringify(payload)}));}catch(error){setError(error instanceof Error?error.message:'Could not preview import.');}finally{setBusy(false);}}
  async function confirm(){if(!preview)return;setBusy(true);setError('');try{let id=target;setResult(await api<ImportSummary>(`/word-lists/${id}/import-collection`,{method:'POST',body:JSON.stringify(payload)}));}catch(error){setError(error instanceof Error?error.message:'Could not import this collection.');setPreview(null);}finally{setBusy(false);}}
  return <div className="collection-modal-backdrop"><div className="collection-modal" role="dialog" aria-modal="true" aria-labelledby="collection-import-title" ref={dialog} onKeyDown={event=>{if(event.key==='Escape'&&!busy)onClose();if(event.key==='Tab'){const controls=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea');const first=controls?.[0],last=controls?.[controls.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}}}>
    <h2 id="collection-import-title">Add to My Word List</h2><p>{collection.name} · {selectedIds===undefined?'Entire collection':`${selectedIds.length} selected words`}</p>
    {!signedIn?<><p>Sign in to save a collection to your My Word List.</p><button type="button" onClick={onSignIn}>Sign in</button></>:result?<><p role="status">{result.added} added · {result.skipped} duplicates skipped · {result.failed} failed</p><button type="button" className="account-action" onClick={()=>onImported(target)}>Open word list</button></>:<>
      <p>Destination: My Word List</p>
      <p>Existing custom definitions, languages, and learning progress will be kept.</p>
      {preview?<><p role="status">{preview.totalRequested} requested · {preview.added} to add · {preview.skipped} duplicates to skip</p><button type="button" className="account-action" disabled={busy} onClick={()=>void confirm()}>{busy?'Adding…':'Confirm import'}</button></>:<button type="button" className="account-action" disabled={busy||!target} onClick={()=>void check()}>{busy?'Checking…':'Preview import'}</button>}
    </>}
    {error&&<p role="alert">{error}</p>}<button type="button" disabled={busy} onClick={onClose}>Close</button>
  </div></div>;
}
