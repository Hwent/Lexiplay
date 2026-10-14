export type VocabularyCollection = { id:string;slug:string;name:string;description:string;category:string;level:string|null;author:string|null;source:string|null;license:string|null;version:string;status:string;wordCount:number;familyCount?:number;otherUnitCount?:number;memberCount?:number };
export type CollectionWord = { inMyWordList?:boolean; id:string;lemma:string;partOfSpeech:string;stage:string;definition:string|null;language:string|null;definitionSource:string|null };
export type CollectionFamily = {id:string;headword:string;kind:'family'|'phrase'|'unclassified';memberIds:string[];relatedMembers:{lemma:string;partsOfSpeech:string[];level:string}[]};
export type CollectionPage = { collection:VocabularyCollection;page:number;pageSize:number;total:number;partsOfSpeech:string[];stages:string[];words:CollectionWord[];families?:CollectionFamily[];pageUnit?:'family';memberTotal?:number };
export type PersonalList = { id:string;name:string;isDefault:boolean;preferredLanguage:string;wordCount:number };
export type PersonalWord = CollectionWord & { dictionaryEntryId:string;familiarity:number;nextReviewAt:string|null };
export type PersonalPage = { list:PersonalList;page:number;pageSize:number;total:number;words:PersonalWord[] };
export type ImportSummary = { success:boolean;totalRequested:number;added:number;skipped:number;failed:number };
