import { useTranslation } from './i18n';
import usePendingWords from './usePendingWords';
import { useEffect, useRef, useState } from 'react';
import { apiRequest as api } from './services/api-client';
import { ImportSummary, PersonalList, VocabularyCollection } from './collection-types';
export default function CollectionImportDialog({collection,selectedIds,signedIn,onClose,onImported,onSignIn,onAdded}:{collection:VocabularyCollection;selectedIds:string[]|undefined;signedIn:boolean;onClose:()=>void;onImported:(id:string)=>void;onSignIn:()=>void;onAdded?:()=>void}) {
  const t = useTranslation();
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
  async function confirm(){if(!preview)return;setBusy(true);setError('');try{const summary=await api<ImportSummary>(`/word-lists/${target}/import-collection`,{method:'POST',body});store.invalidateWords();setResult(summary);onAdded?.();}catch(error){setError(error instanceof Error?error.message:'Could not add these words.');setPreview(null);}finally{setBusy(false);}}
  return <div className="collection-modal-backdrop"><div className="collection-modal" role="dialog" aria-modal="true" aria-busy={checking||busy} aria-labelledby="collection-import-title" ref={dialog} tabIndex={-1} onKeyDown={event=>{
    if(event.key==='Escape'&&!busy)onClose();
    if(event.key==='Tab'){const controls=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea');const first=controls?.[0],last=controls?.[controls.length-1];if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===dialog.current)){event.preventDefault();first?.focus();}}
  }}>
    <h2 id="collection-import-title">{t('Add to My Word List')}</h2><p>{collection.name} · {selectedIds===undefined ? t('All words') : t('{0} selected', selectedIds.length)}</p>
    {!signedIn?<><p>{t('Sign in to add these words.')}</p><button type="button" onClick={onSignIn}>{t('Sign in')}</button></>:result?<>
      {result.failed>0&&<p role="alert">{t('{0} could not be added.', result.failed)}</p>}
      <button type="button" className="account-action" onClick={()=>onImported(target)}>{t('Open My Word List')}</button>
    </>:<>
      {preview&&<><p role="status">{preview.added===0 ? t('All selected words are already in your list.') : t('{0} new {1} be added.', preview.added, (preview.added===1 ? t('word will') : t('words will')))}{preview.skipped>0&&preview.added>0 ? t(' {0} already in your list will be skipped.', preview.skipped) : ''}</p><button type="button" className="account-action" disabled={busy||!preview.added} onClick={()=>void confirm()}>{t('Add to My Word List')}</button></>}
    </>}
    {error&&<p role="alert">{t(error)} <button type="button" disabled={busy} onClick={()=>setRetry(value=>value+1)}>{t('Try again')}</button></p>}
    <button type="button" disabled={busy} onClick={onClose}>{result ? t('Done') : t('Cancel')}</button>
  </div></div>;
}
