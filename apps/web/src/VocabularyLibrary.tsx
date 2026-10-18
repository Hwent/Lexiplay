import { useTranslation } from './i18n';
import { useEffect, useState } from 'react';
import ExploreVocabulary from './ExploreVocabulary';
import PersonalWordLists from './PersonalWordLists';
import './library.css';
import Icon from './Icon';
export default function VocabularyLibrary({signedIn,searchQuery,onSignIn,onUseCollection}:{signedIn:boolean;searchQuery:string;onSignIn:()=>void;onUseCollection?:((id:string)=>void)|undefined}) {
  const t = useTranslation();
  const [tab,setTab]=useState<'explore'|'mine'>(searchQuery?'mine':'explore'),[listId,setListId]=useState(''),[revision,setRevision]=useState(0);
  useEffect(()=>{if(searchQuery)setTab('mine');},[searchQuery]);
  return <>
    <header className="library-heading"><h2>{t('Vocabulary')}</h2><Icon name="library"/></header>
    <div className="vocabulary-library-tabs" role="tablist" aria-label={t('Vocabulary library')}><button id="library-explore-tab" type="button" role="tab" aria-controls="library-panel" aria-selected={tab==='explore'} onClick={()=>setTab('explore')}><Icon name="explore"/>{t(' Explore Vocabulary')}</button><button id="library-mine-tab" type="button" role="tab" aria-controls="library-panel" aria-selected={tab==='mine'} onClick={()=>setTab('mine')}><Icon name="library"/>{t(' My Word List')}</button></div>
    <div id="library-panel" role="tabpanel" aria-labelledby={tab==='explore'?'library-explore-tab':'library-mine-tab'}>{tab==='explore'?<ExploreVocabulary onUseCollection={onUseCollection} signedIn={signedIn} onSignIn={onSignIn} onImported={id=>{setListId(id);setRevision(value=>value+1);setTab('mine');}}/>:<PersonalWordLists signedIn={signedIn} searchQuery={searchQuery} initialId={listId} revision={revision} onOpenCollection={slug=>{const url=new URL(location.href);url.searchParams.set('collection',slug);history.replaceState({},'',url);setTab('explore');}}/>}</div>
  </>;
}
