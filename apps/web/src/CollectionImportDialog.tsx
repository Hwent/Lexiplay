import usePendingWords from './usePendingWords';
import { useEffect, useRef, useState } from 'react';
import { apiRequest as api } from './services/api-client';
import { ImportSummary, PersonalList, VocabularyCollection } from './collection-types';
export default function CollectionImportDialog({collection,selectedIds,signedIn,onClose,onImported,onSignIn,onAdded}:{collection:VocabularyCollection;selectedIds:string[]|undefined;signedIn:boolean;onClose:()=>void;onImported:(id:string)=>void;onSignIn:()=>void;onAdded?:()=>void}) {
  const { store } = usePendingWords(signedIn ? 'library' : '');
  const [target,setTarget]=useState(''),[preview,setPreview]=useState<ImportSummary|null>(null),[result,setResult]=useState<ImportSummary|null>(null),[busy,setBusy]=useState(false),[checking,setChecking]=useState(signedIn),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const dialog=useRef<HTMLDivElement>(null);
  const payload={collectionId:collection.slug,...(selectedIds!==undefined?{selectedWordIds:selectedIds}:{}),duplicatePolicy:'skip'};
  const body=JSON.stringify(payload);
  useEffect(()=>{const previous=document.activeElement;dialog.current?.focus();return()=>{if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};},[]);
  useEffect(()=>{
    if(!signedIn)return;let active=true;setChecking(true);setError('');setPreview(null);
    void (async()=>{const lists=await store.requests.get<PersonalList[]>('/word-lists/mine');const overall=lists.find(list=>list.isDefault)||lists[0];if(!overall)throw new Error('Could not load My Word List.');
      const summary=await api<ImportSummary>(`/word-lists/${overall.id}/import-collection/preview`,{method:'POST',body});
      if(active){setTarget(overall.id);setPreview(summary);}
    })().catch(error=>{if(active)setError(error instanceof Error?error.message:'Could not check selected words.');}).finally(()=>{if(active)setChecking(false);});
    return()=>{active=false;};
  },[signedIn,body,retry,store]);
  async function confirm(){if(!preview)return;setBusy(true);setError('');try{const summary=await api<ImportSummary>(`/word-lists/${target}/import-collection`,{method:'POST',body});store.invalidateWords();void store.loadSaved(true).catch(()=>{});setResult(summary);onAdded?.();}catch(error){setError(error instanceof Error?error.message:'Could not add these words.');setPreview(null);}finally{setBusy(false);}}
  return <div className="collection-modal-backdrop"><div className="collection-modal" role="dialog" aria-modal="true" aria-labelledby="collection-import-title" ref={dialog} tabIndex={-1} onKeyDown={event=>{
    if(event.key==='Escape'&&!busy)onClose();
    if(event.key==='Tab'){const controls=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea');const first=controls?.[0],last=controls?.[controls.length-1];if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===dialog.current)){event.preventDefault();first?.focus();}}
  }}>
    <h2 id="collection-import-title">Add to My Word List</h2><p>{collection.name} · {selectedIds===undefined?'All words':`${selectedIds.length} selected`}</p>
    {!signedIn?<><p>Sign in to add these words.</p><button type="button" onClick={onSignIn}>Sign in</button></>:result?<>
      <p role="status">{result.added===1?'1 word added.':`${result.added} words added.`}{result.skipped>0?` ${result.skipped} already in your list and left unchanged.`:''}{result.failed>0?` ${result.failed} could not be added.`:''}</p>
      <button type="button" className="account-action" onClick={()=>onImported(target)}>Open My Word List</button>
    </>:<>
      {checking&&<p role="status">Checking your word list…</p>}
      {preview&&<><p role="status">{preview.added===0?'All selected words are already in your list.':`${preview.added} new ${preview.added===1?'word will':'words will'} be added.`}{preview.skipped>0&&preview.added>0?` ${preview.skipped} already in your list will be skipped.`:''}</p><p className="collection-stage-note">Your saved definitions and review progress will stay unchanged.</p><button type="button" className="account-action" disabled={busy||!preview.added} onClick={()=>void confirm()}>{busy?'Adding…':'Add to My Word List'}</button></>}
    </>}
    {error&&<p role="alert">{error} <button type="button" disabled={busy} onClick={()=>setRetry(value=>value+1)}>Try again</button></p>}
    <button type="button" disabled={busy} onClick={onClose}>{result?'Done':'Cancel'}</button>
  </div></div>;
}
