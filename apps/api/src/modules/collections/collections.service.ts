import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AccountService } from '../accounts/account.service';
import { WordListRepository } from '../word-lists/word-list.repository';
import { CEFR_POOLS } from '../word-lists/cefr-pools';
import { CollectionsStorage } from './collections.storage';
import { displayedDefinition } from './definition-rules';
import { AddDictionaryEntries, CollectionWordsQuery, ImportCollection, NewPersonalList, UpdatePersonalEntry } from './collections.dto';
import { Prisma } from '../../generated/prisma/client';
import { familyCounts, groupFamilies, wordFamily } from '../word-lists/word-families';

type FamilyRow = { dictionaryEntryId: string; stage: string; sortOrder: number; entry: { id: string; lemma: string; normalizedLemma: string; partOfSpeech: string } };
const relatedByFamily = new Map<string,{lemma:string;partsOfSpeech:string[];level:string}[]>();
for(const pool of CEFR_POOLS)for(const word of pool.words){
  const id=wordFamily(word.term).id, members=relatedByFamily.get(id)??[];
  members.push({lemma:word.term,partsOfSpeech:word.partsOfSpeech,level:pool.level});relatedByFamily.set(id,members);
}

@Injectable()
export class CollectionsService {
  private ready?: Promise<void>;
  private familyRows = new Map<string, FamilyRow[]>();
  constructor(@Inject(CollectionsStorage) private readonly db: CollectionsStorage,
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(WordListRepository) private readonly dictionary: WordListRepository) {}
  private ensureReady() { this.ready ??= this.seed(); return this.ready; }
  private async seed() {
    const familyRows = new Map<string, FamilyRow[]>();
    const unique = new Map(CEFR_POOLS.flatMap(pool => pool.words.flatMap(word => word.partsOfSpeech.map(partOfSpeech => {
      const value = { lemma: word.term, normalizedLemma: word.term, partOfSpeech };
      return [word.term+'\0'+partOfSpeech,value] as const;
    }))));
    await this.db.$transaction(async tx => {
      await tx.dictionaryEntry.createMany({ data: [...unique.values()], skipDuplicates: true });
      const entries = await tx.dictionaryEntry.findMany({ where: { normalizedLemma: { in: [...new Set([...unique.values()].map(word => word.normalizedLemma))] } } });
      const identities = new Map(entries.map(entry => [entry.normalizedLemma+'\0'+entry.partOfSpeech,entry.id]));
      for (const pool of CEFR_POOLS) {
        const metadata = { name:'CEFR '+pool.level,description:pool.description??'Oxford vocabulary for CEFR '+pool.level+'.',category:'CEFR',level:pool.level,author:pool.author,
          source:pool.source??'Oxford 3000/5000 — supplied en-'+pool.level+'.json',license:pool.license??null,version:pool.version??'supplied-2026-10-14',status:'available' };
        const collection = await tx.vocabularyCollection.upsert({ where:{slug:'cefr-'+pool.level.toLowerCase()},create:{slug:'cefr-'+pool.level.toLowerCase(),...metadata},update:metadata });
        const data = pool.words.flatMap((word,index) => word.partsOfSpeech.map(partOfSpeech => ({collectionId:collection.id,dictionaryEntryId:identities.get(word.term+'\0'+partOfSpeech)!,stage:'Core',sortOrder:index})));
        await tx.collectionEntry.createMany({data,skipDuplicates:true});
        familyRows.set(collection.slug, pool.words.flatMap((word,index) => word.partsOfSpeech.map(partOfSpeech => {
          const id=identities.get(word.term+'\0'+partOfSpeech)!;
          return {dictionaryEntryId:id,stage:'Core',sortOrder:index,entry:{id,lemma:word.term,normalizedLemma:word.term,partOfSpeech}};
        })));
      }
      for (const [slug,name,category,level] of [['ielts-core','IELTS Core Vocabulary','IELTS',null],['toefl-academic','TOEFL Academic Vocabulary','TOEFL',null]] as const) {
        await tx.vocabularyCollection.upsert({where:{slug},create:{slug,name,category,level,description:'Source data has not been supplied yet.',source:null,license:null,version:'awaiting-source',status:'awaiting_data'},update:{}});
      }
    },{timeout:120000,maxWait:30000});
    this.familyRows=familyRows;
  }
  async categories() { return ['CEFR','IELTS','TOEFL']; }
  async catalog(category?: string) {
    await this.ensureReady();
    const collections=await this.db.vocabularyCollection.findMany({where:category?{category}:{},include:{_count:{select:{entries:true}}},orderBy:[{category:'asc'},{slug:'asc'}]});
    return collections.map(({_count,...collection})=>({...collection,wordCount:_count.entries,...this.collectionFamilyCounts(collection.slug)}));
  }
  private collectionFamilyCounts(slug:string) {
    const rows=this.familyRows.get(slug);
    return rows?{...familyCounts(rows.map(row=>row.entry.normalizedLemma)),memberCount:rows.length}:{};
  }
  private async collection(slug: string) {
    await this.ensureReady();
    const where = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(slug)?{OR:[{id:slug},{slug}]}:{slug};
    const collection=await this.db.vocabularyCollection.findFirst({where,include:{_count:{select:{entries:true}}}});
    if(!collection)throw new NotFoundException('Vocabulary collection not found.');
    const {_count,...value}=collection;return {...value,wordCount:_count.entries,...this.collectionFamilyCounts(collection.slug)};
  }
  detail(slug:string) { return this.collection(slug); }
  async snapshot(slug:string) {
    const collection=await this.collection(slug);
    if(!this.familyRows.has(collection.slug))throw new BadRequestException('This collection is not available for local storage.');
    return this.familyWords(collection,{},1,Math.max(1,this.familyRows.get(collection.slug)!.length));
  }
  private async english(entries: {id:string;normalizedLemma:string;partOfSpeech:string}[]) {
    const words=await this.dictionary.poolDictionaryEntries([...new Set(entries.map(entry=>entry.normalizedLemma))]);
    const map=new Map(words.map(word=>[word.term,word.senses]));
    return new Map(entries.map(entry=>[entry.id,(map.get(entry.normalizedLemma)??[]).filter(sense=>!entry.partOfSpeech || sense.partOfSpeech===entry.partOfSpeech
      || (entry.partOfSpeech==='number'&&sense.partOfSpeech==='numeral')).flatMap(sense=>sense.definitions).join('; ')||null]));
  }
  async words(slug:string,query:CollectionWordsQuery,cookie?:string) {
    const collection=await this.collection(slug);const page=Math.max(1,Number(query.page??1));const pageSize=Number(query.pageSize??25);
    if(query.view==='families' && this.familyRows.has(collection.slug))return this.familyWords(collection,query,page,pageSize,cookie);
    const where:Prisma.CollectionEntryWhereInput={collectionId:collection.id,...(query.stage?{stage:query.stage}:{}),entry:{...(query.q?{normalizedLemma:{contains:query.q.trim().toLowerCase()}}:{}),...(query.partOfSpeech?{partOfSpeech:query.partOfSpeech}:{})}};
    const [total,rows,positions]=await Promise.all([this.db.collectionEntry.count({where}),this.db.collectionEntry.findMany({where,skip:(page-1)*pageSize,take:pageSize,orderBy:[{sortOrder:'asc'},{dictionaryEntryId:'asc'}],include:{entry:{include:{definitions:true}}}}),this.db.collectionEntry.findMany({where:{collectionId:collection.id},select:{entry:{select:{partOfSpeech:true}}},distinct:['dictionaryEntryId']})]);
    const english=await this.english(rows.map(row=>row.entry));
    const added=new Set<string>();
    if(cookie){
      const user=await this.accounts.current(cookie);
      const list=await this.db.userWordList.findUnique({where:{userId:user.id}});
      if(list){
        const existing=await this.db.wordListEntry.findMany({where:{wordListId:list.id,dictionaryEntryId:{in:rows.map(row=>row.dictionaryEntryId)}},select:{dictionaryEntryId:true}});
        existing.forEach(row=>added.add(row.dictionaryEntryId));
      }
    }
    return {collection,page,pageSize,total,partsOfSpeech:[...new Set(positions.map(row=>row.entry.partOfSpeech))].sort(),stages:['Foundation','Core','Advanced'],
      words:rows.map(row=>({id:row.entry.id,lemma:row.entry.lemma,partOfSpeech:row.entry.partOfSpeech,stage:row.stage,inMyWordList:added.has(row.entry.id),...displayedDefinition(null,null,(query.language??'en').toLowerCase(),row.entry.definitions,english.get(row.entry.id)??null)}))};
  }
  private async familyWords(collection:Awaited<ReturnType<CollectionsService['collection']>>,query:CollectionWordsQuery,page:number,pageSize:number,cookie?:string) {
    const all=this.familyRows.get(collection.slug)!;
    const search=query.q?.trim().toLowerCase();
    const filtered=all.filter(row=>(!query.stage||row.stage===query.stage)&&(!query.partOfSpeech||row.entry.partOfSpeech===query.partOfSpeech)
      &&(!search||row.entry.normalizedLemma.includes(search)||wordFamily(row.entry.normalizedLemma).headword.includes(search)));
    const groups=groupFamilies(filtered,row=>row.entry.normalizedLemma);
    const selected=groups.slice((page-1)*pageSize,page*pageSize), rows=selected.flatMap(family=>family.members);
    const [english,definitions]=await Promise.all([this.english(rows.map(row=>row.entry)),
      rows.length?this.db.dictionaryDefinition.findMany({where:{dictionaryEntryId:{in:rows.map(row=>row.entry.id)},reviewStatus:'approved'}}):Promise.resolve([])]);
    const added=new Set<string>();
    if(cookie && rows.length){
      const user=await this.accounts.current(cookie);
      const saved=await this.db.wordListEntry.findMany({where:{list:{userId:user.id},dictionaryEntryId:{in:rows.map(row=>row.dictionaryEntryId)}},select:{dictionaryEntryId:true}});
      saved.forEach(row=>added.add(row.dictionaryEntryId));
    }
    const definitionsByEntry = new Map<string, typeof definitions>();
    for (const definition of definitions) {
      const entryDefinitions = definitionsByEntry.get(definition.dictionaryEntryId) ?? [];
      entryDefinitions.push(definition);
      definitionsByEntry.set(definition.dictionaryEntryId, entryDefinitions);
    }
    const language = (query.language ?? 'en').toLowerCase();
    const words=rows.map(row=>({id:row.entry.id,lemma:row.entry.lemma,partOfSpeech:row.entry.partOfSpeech,stage:row.stage,inMyWordList:added.has(row.entry.id),
      ...displayedDefinition(null,null,language,definitionsByEntry.get(row.entry.id)??[],english.get(row.entry.id)??null)}));
    return {collection,page,pageSize,total:groups.length,memberTotal:filtered.length,pageUnit:'family',
      partsOfSpeech:[...new Set(all.map(row=>row.entry.partOfSpeech))].sort(),stages:['Foundation','Core','Advanced'],words,
      families:selected.map(family=>({id:family.id,headword:family.headword,kind:family.kind,memberIds:family.members.map(row=>row.entry.id),
        relatedMembers:(relatedByFamily.get(family.id)??[]).filter(word=>word.level!==collection.level)}))};
  }
  private async user(cookie:string|undefined) {
    const user=await this.accounts.current(cookie);await this.dictionary.ensurePersonalList(user.id);return user;
  }
  private async owned(userId:string,id:string) {
    const list=await this.db.userWordList.findFirst({where:{id,userId}});if(!list)throw new NotFoundException('Word list not found.');return list;
  }
  async lists(cookie:string|undefined) {
    const user=await this.user(cookie);await this.ensureReady();
    const rows=await this.db.userWordList.findMany({where:{userId:user.id},include:{_count:{select:{entries:true}}},orderBy:[{isDefault:'desc'},{createdAt:'asc'}]});
    return rows.map(({_count,...row})=>({...row,wordCount:_count.entries}));
  }
  async createList(cookie:string|undefined,input:NewPersonalList) {
    const user=await this.user(cookie);
    return this.db.userWordList.findFirstOrThrow({where:{userId:user.id,isDefault:true}});
  }
  async savedTerms(cookie:string|undefined) {
    const user=await this.user(cookie);
    const entries=await this.db.wordListEntry.findMany({where:{list:{userId:user.id}},select:{entry:{select:{normalizedLemma:true,id:true}}}});
    return {terms:[...new Set(entries.map(row=>row.entry.normalizedLemma))],entryIds:[...new Set(entries.map(row=>row.entry.id))]};
  }
  async savedCollections(cookie:string|undefined) {
    const user=await this.user(cookie);await this.ensureReady();
    return this.db.$queryRaw`SELECT c.* FROM vocabulary_collections c JOIN user_vocabulary_collections u ON u.collection_id=c.id WHERE u.user_id=${user.id}::uuid ORDER BY c.name`;
  }

  async saveCollection(cookie:string|undefined,slug:string) {
    const user=await this.user(cookie);const collection=await this.collection(slug);
    if(collection.status!=='available')throw new BadRequestException('This collection is awaiting source data.');
    await this.db.$executeRaw`INSERT INTO user_vocabulary_collections(user_id,collection_id) VALUES (${user.id}::uuid,${collection.id}::uuid) ON CONFLICT DO NOTHING`;
    return {success:true};
  }
  private async requested(input:ImportCollection) {
    if(input.selectedWordIds!==undefined&&(!Array.isArray(input.selectedWordIds)||input.selectedWordIds.length===0))throw new BadRequestException('Select at least one word.');
    const collection=await this.collection(input.collectionId);
    if(collection.status!=='available')throw new BadRequestException('This collection is awaiting source data.');
    const rows=await this.db.collectionEntry.findMany({where:{collectionId:collection.id,...(input.selectedWordIds?{dictionaryEntryId:{in:input.selectedWordIds}}:{})},include:{entry:true}});
    if(input.selectedWordIds&&rows.length!==new Set(input.selectedWordIds).size)throw new BadRequestException('Every selected word must belong to this collection.');
    return {collection,rows};
  }
  async importCollection(cookie:string|undefined,id:string,input:ImportCollection,preview=false) {
    const user=await this.user(cookie);await this.owned(user.id,id);const {collection,rows}=await this.requested(input);
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM user_word_lists WHERE id=${id}::uuid AND owner_id=${user.id}::uuid FOR UPDATE`;
      const existing=await tx.wordListEntry.findMany({where:{wordListId:id,dictionaryEntryId:{in:rows.map(row=>row.dictionaryEntryId)}},select:{dictionaryEntryId:true}});
      const identities=new Set(existing.map(row=>row.dictionaryEntryId));const fresh=rows.filter(row=>!identities.has(row.dictionaryEntryId));
      if(preview)return {success:true,totalRequested:rows.length,added:fresh.length,skipped:rows.length-fresh.length,failed:0,preview:true};
      await tx.$executeRaw`INSERT INTO user_vocabulary_collections(user_id,collection_id) VALUES (${user.id}::uuid,${collection.id}::uuid) ON CONFLICT DO NOTHING`;
      const result=await tx.wordListEntry.createMany({data:fresh.map(row=>({wordListId:id,dictionaryEntryId:row.dictionaryEntryId,stage:row.stage,importedCollectionId:collection.id})),skipDuplicates:true});
      const added=await tx.wordListEntry.findMany({where:{wordListId:id,dictionaryEntryId:{in:fresh.map(row=>row.dictionaryEntryId)}},select:{id:true}});
      await tx.learningProgress.createMany({data:added.map(row=>({wordListEntryId:row.id})),skipDuplicates:true});
      return {success:true,totalRequested:rows.length,added:result.count,skipped:rows.length-result.count,failed:0};
    });
  }
  async addDictionaryEntries(cookie:string|undefined,id:string,input:AddDictionaryEntries) {
    const user=await this.user(cookie);
    await this.owned(user.id,id);
    await this.ensureReady();
    const terms=[...new Set(input.terms.map(term=>term.trim().toLowerCase()))];
    if(terms.some(term=>!term))throw new BadRequestException('Enter a word for every row.');
    const dictionary=await this.dictionary.poolDictionaryEntries(terms);
    const valid=dictionary.filter(word=>word.senses.some(sense=>sense.definitions.some(definition=>definition.trim())));
    const found=new Set(valid.map(word=>word.term));
    const missing=terms.filter(term=>!found.has(term));
    const identities=new Map<string,{lemma:string;normalizedLemma:string;partOfSpeech:string}>();
    for(const word of valid){
      for(const sense of word.senses.filter(sense=>sense.definitions.some(definition=>definition.trim()))){
        const partOfSpeech=sense.partOfSpeech==='numeral'?'number':sense.partOfSpeech;
        identities.set(word.term+'\0'+partOfSpeech,{lemma:word.term,normalizedLemma:word.term,partOfSpeech});
      }
    }
    const dictionaryRows=[...identities.values()].sort((a,b)=>a.normalizedLemma.localeCompare(b.normalizedLemma)||a.partOfSpeech.localeCompare(b.partOfSpeech));
    if(!dictionaryRows.length)return {success:true,added:0,skipped:0,missing};
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM user_word_lists WHERE id=${id}::uuid AND owner_id=${user.id}::uuid FOR UPDATE`;
      await tx.dictionaryEntry.createMany({data:dictionaryRows,skipDuplicates:true});
      const dictionary=await tx.dictionaryEntry.findMany({where:{OR:dictionaryRows.map(({normalizedLemma,partOfSpeech})=>({normalizedLemma,partOfSpeech}))},select:{id:true}});
      const dictionaryIds=dictionary.map(entry=>entry.id);
      const result=await tx.wordListEntry.createMany({data:dictionaryIds.map(dictionaryEntryId=>({wordListId:id,dictionaryEntryId})),skipDuplicates:true});
      const entries=await tx.wordListEntry.findMany({where:{wordListId:id,dictionaryEntryId:{in:dictionaryIds}},select:{id:true}});
      await tx.learningProgress.createMany({data:entries.map(entry=>({wordListEntryId:entry.id})),skipDuplicates:true});
      return {success:true,added:result.count,skipped:dictionaryIds.length-result.count,missing};
    },{timeout:30000});
  }
  async entries(cookie:string|undefined,id:string,query:CollectionWordsQuery) {
    const user=await this.user(cookie);const list=await this.owned(user.id,id);const language=(query.language??list.preferredLanguage).toLowerCase();
    const page=Math.max(1,Number(query.page??1)),pageSize=Number(query.pageSize??25);
    const where: Prisma.WordListEntryWhereInput = {
      wordListId: id,
      ...(query.q || query.partOfSpeech ? {
        entry: {
          ...(query.q ? { normalizedLemma: { contains: query.q.trim().toLowerCase() } } : {}),
          ...(query.partOfSpeech ? { partOfSpeech: query.partOfSpeech } : {}),
        },
      } : {}),
      ...(query.stage ? { stage: query.stage } : {}),
      ...(query.review ? { OR: [{ progress: null }, { progress: { nextReviewAt: null } }, { progress: { nextReviewAt: { lte: new Date() } } }] } : {}),
    };
    const [total,rows]=await Promise.all([this.db.wordListEntry.count({where}),this.db.wordListEntry.findMany({where,skip:(page-1)*pageSize,take:pageSize,include:{entry:{include:{definitions:true}},progress:true},orderBy:[{createdAt:'asc'},{id:'asc'}]})]);
    const english=await this.english(rows.map(row=>row.entry));
    const words=rows.map(row=>({id:row.id,dictionaryEntryId:row.entry.id,lemma:row.entry.lemma,partOfSpeech:row.entry.partOfSpeech,stage:row.stage,familiarity:row.progress?.familiarity??0,nextReviewAt:row.progress?.nextReviewAt??null,...displayedDefinition(null,null,language,row.entry.definitions,english.get(row.entry.id)??null)}));
    return {list,page,pageSize,total,words};
  }
  async updateEntry(cookie:string|undefined,id:string,entryId:string,input:UpdatePersonalEntry) {
    if(!Object.keys(input).length)throw new BadRequestException('Change a review setting.');
    const user=await this.user(cookie);await this.owned(user.id,id);
    const row=await this.db.wordListEntry.findFirst({where:{id:entryId,wordListId:id}});
    if(!row)throw new NotFoundException('Personal entry not found.');
    return this.db.wordListEntry.update({where:{id:row.id},data:{...(input.stage?{stage:input.stage}:{}),...((input.familiarity!==undefined||input.nextReviewAt!==undefined)?{progress:{upsert:{create:{familiarity:input.familiarity??0,nextReviewAt:input.nextReviewAt?new Date(input.nextReviewAt):null},update:{...(input.familiarity!==undefined?{familiarity:input.familiarity}:{}),...(input.nextReviewAt!==undefined?{nextReviewAt:input.nextReviewAt?new Date(input.nextReviewAt):null}:{})}}}}:{})}});
  }

  async gameWords(cookie:string|undefined,id:string,length:number) {
    const user=await this.user(cookie);const list=await this.owned(user.id,id);
    const rows=await this.db.wordListEntry.findMany({where:{wordListId:id},select:{entry:{include:{definitions:true}}}});
    const candidates=rows.map(row=>row.entry).filter(entry=>entry.lemma.length===length&&/^[a-z]+$/i.test(entry.lemma));
    const english=await this.english(candidates);
    const words=[...new Set(candidates.filter(entry=>displayedDefinition(null,null,list.preferredLanguage,entry.definitions,english.get(entry.id)??null).definition).map(entry=>entry.lemma.toLowerCase()))];
    if(!words.length)throw new BadRequestException('This word list has no playable words at this length.');return words;
  }
}
