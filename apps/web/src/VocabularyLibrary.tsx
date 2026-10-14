import { useEffect, useState } from 'react';
import ExploreVocabulary from './ExploreVocabulary';
import PersonalWordLists from './PersonalWordLists';
import { PersonalList } from './collection-types';
import { apiRequest as api } from './services/api-client';
export default function VocabularyLibrary({signedIn,searchQuery,onSignIn}:{signedIn:boolean;searchQuery:string;onSignIn:()=>void}) {
  const [tab,setTab]=useState<'explore'|'mine'>(searchQuery?'mine':'explore'),[listId,setListId]=useState(''),[revision,setRevision]=useState(0);
  useEffect(()=>{if(searchQuery)setTab('mine');},[searchQuery]);
  return <><div className="vocabulary-library-tabs" role="tablist" aria-label="Vocabulary library"><button type="button" role="tab" aria-selected={tab==='explore'} onClick={()=>setTab('explore')}>Explore Vocabulary</button><button type="button" role="tab" aria-selected={tab==='mine'} onClick={()=>setTab('mine')}>My Word List</button></div>{tab==='explore'?<ExploreVocabulary signedIn={signedIn} onSignIn={onSignIn} onImported={id=>{setListId(id);setRevision(value=>value+1);setTab('mine');}}/>:<PersonalWordLists signedIn={signedIn} searchQuery={searchQuery} initialId={listId} revision={revision}/>}</>;
}
export function PersonalListPicker({value,onChange}:{value:string;onChange:(id:string)=>void}) {
  const [error,setError]=useState('');
  useEffect(()=>{let active=true;api<PersonalList[]>('/word-lists/mine').then(rows=>{if(active&&Array.isArray(rows)){if(!value&&rows[0])onChange(rows[0].id);}}).catch(error=>{if(active)setError(error instanceof Error?error.message:'Could not load your lists.');});return()=>{active=false;};},[]);
  return error?<p role="alert">{error}</p>:null;
}
