import { useEffect, useState } from 'react';
import ExploreVocabulary from './ExploreVocabulary';
import PersonalWordLists from './PersonalWordLists';
import { PersonalList } from './collection-types';
import './library.css';
import Icon from './Icon';
import usePendingWords from './usePendingWords';
export default function VocabularyLibrary({signedIn,searchQuery,onSignIn,onUseCollection}:{signedIn:boolean;searchQuery:string;onSignIn:()=>void;onUseCollection?:((id:string)=>void)|undefined}) {
  const [tab,setTab]=useState<'explore'|'mine'>(searchQuery?'mine':'explore'),[listId,setListId]=useState(''),[revision,setRevision]=useState(0);
  useEffect(()=>{if(searchQuery)setTab('mine');},[searchQuery]);
  return <>
    {tab==='explore'&&<header className="library-introduction">
      <div><p className="library-eyebrow">YOUR LEARNING SPACE</p><h2>A world of words.<br/><span>Make it yours.</span></h2><p>Discover your next collection, keep the words you love, and build a little confidence every day.</p></div>
      <div className="library-art" aria-hidden="true"><span>Aa</span><span>words worth keeping</span><i><Icon name="plus"/></i></div>
    </header>}
    <div className="vocabulary-library-tabs" role="tablist" aria-label="Vocabulary library"><button id="library-explore-tab" type="button" role="tab" aria-controls="library-panel" aria-selected={tab==='explore'} onClick={()=>setTab('explore')}><Icon name="explore"/> Explore Vocabulary</button><button id="library-mine-tab" type="button" role="tab" aria-controls="library-panel" aria-selected={tab==='mine'} onClick={()=>setTab('mine')}><Icon name="library"/> My Word List</button></div>
    <div id="library-panel" role="tabpanel" aria-labelledby={tab==='explore'?'library-explore-tab':'library-mine-tab'}>{tab==='explore'?<ExploreVocabulary onUseCollection={onUseCollection} signedIn={signedIn} onSignIn={onSignIn} onImported={id=>{setListId(id);setRevision(value=>value+1);setTab('mine');}}/>:<PersonalWordLists signedIn={signedIn} searchQuery={searchQuery} initialId={listId} revision={revision}/>}</div>
  </>;
}
export function PersonalListPicker({value,onChange}:{value:string;onChange:(id:string)=>void}) {
  const { store } = usePendingWords();
  const [error,setError]=useState('');
  useEffect(()=>{let active=true;store.requests.get<PersonalList[]>('/word-lists/mine').then(rows=>{if(active&&Array.isArray(rows)){if(!value&&rows[0])onChange(rows[0].id);}}).catch(error=>{if(active)setError(error instanceof Error?error.message:'Could not load your lists.');});return()=>{active=false;};},[store]);
  return error?<p role="alert">{error}</p>:null;
}
