import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AccountService } from '../accounts/account.service';
import { WordListRepository } from '../word-lists/word-list.repository';
import { CEFR_POOLS } from '../word-lists/cefr-pools';
import { CollectionsStorage } from './collections.storage';
import { displayedDefinition } from './definition-rules';
import { CollectionWordsQuery, ImportCollection, NewPersonalList, UpdatePersonalEntry } from './collections.dto';
import { Prisma } from '../../generated/prisma/client';

type LegacyWord = { id: string; term: string; definition: string; part_of_speech: string | null; status: string; custom_language: string | null; familiarity: number; next_review_at: Date | null; learning_stage: string };
@Injectable()
export class CollectionsService {
  private ready?: Promise<void>;
  constructor(@Inject(CollectionsStorage) private readonly db: CollectionsStorage,
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(WordListRepository) private readonly dictionary: WordListRepository) {}
  private ensureReady() { this.ready ??= this.seed(); return this.ready; }
  private async seed() {
    const unique = new Map(CEFR_POOLS.flatMap(pool => pool.words.flatMap(word => word.partsOfSpeech.map(partOfSpeech => {
      const value = { lemma: word.term, normalizedLemma: word.term, partOfSpeech };
      return [word.term+'\0'+partOfSpeech,value] as const;
    }))));
    await this.db.$transaction(async tx => {
      await tx.dictionaryEntry.createMany({ data: [...unique.values()], skipDuplicates: true });
      const entries = await tx.dictionaryEntry.findMany({ where: { normalizedLemma: { in: [...new Set([...unique.values()].map(word => word.normalizedLemma))] } } });
      const identities = new Map(entries.map(entry => [entry.normalizedLemma+'\0'+entry.partOfSpeech,entry.id]));
      for (const pool of CEFR_POOLS) {
        const metadata = { name:'CEFR '+pool.level,description:'Oxford vocabulary for CEFR '+pool.level+'.',category:'CEFR',level:pool.level,author:pool.author,
          source:'Oxford 3000/5000 — supplied en-'+pool.level+'.json',license:null,version:'supplied-2026-10-14',status:'available' };
        const collection = await tx.vocabularyCollection.upsert({ where:{slug:'cefr-'+pool.level.toLowerCase()},create:{slug:'cefr-'+pool.level.toLowerCase(),...metadata},update:metadata });
        const data = pool.words.flatMap((word,index) => word.partsOfSpeech.map(partOfSpeech => ({collectionId:collection.id,dictionaryEntryId:identities.get(word.term+'\0'+partOfSpeech)!,stage:'Core',sortOrder:index})));
        await tx.collectionEntry.createMany({data,skipDuplicates:true});
      }
      for (const [slug,name,category,level] of [['cefr-c2','CEFR C2','CEFR','C2'],['ielts-core','IELTS Core Vocabulary','IELTS',null],['toefl-academic','TOEFL Academic Vocabulary','TOEFL',null]] as const) {
        await tx.vocabularyCollection.upsert({where:{slug},create:{slug,name,category,level,description:'Source data has not been supplied yet.',source:null,license:null,version:'awaiting-source',status:'awaiting_data'},update:{}});
      }
    },{timeout:120000,maxWait:30000});
  }
  async categories() { return ['CEFR','IELTS','TOEFL']; }
  async catalog(category?: string) {
    await this.ensureReady();
    const collections=await this.db.vocabularyCollection.findMany({where:category?{category}:{},include:{_count:{select:{entries:true}}},orderBy:[{category:'asc'},{slug:'asc'}]});
    return collections.map(({_count,...collection})=>({...collection,wordCount:_count.entries}));
  }
  private async collection(slug: string) {
    await this.ensureReady();
    const where = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(slug)?{OR:[{id:slug},{slug}]}:{slug};
    const collection=await this.db.vocabularyCollection.findFirst({where,include:{_count:{select:{entries:true}}}});
    if(!collection)throw new NotFoundException('Vocabulary collection not found.');
    const {_count,...value}=collection;return {...value,wordCount:_count.entries};
  }
  detail(slug:string) { return this.collection(slug); }
  private async english(entries: {id:string;normalizedLemma:string;partOfSpeech:string}[]) {
    const words=await this.dictionary.poolDictionaryEntries([...new Set(entries.map(entry=>entry.normalizedLemma))]);
    const map=new Map(words.map(word=>[word.term,word.senses]));
    return new Map(entries.map(entry=>[entry.id,(map.get(entry.normalizedLemma)??[]).filter(sense=>!entry.partOfSpeech || sense.partOfSpeech===entry.partOfSpeech
      || (entry.partOfSpeech==='number'&&sense.partOfSpeech==='numeral')).flatMap(sense=>sense.definitions).join('; ')||null]));
  }
  async words(slug:string,query:CollectionWordsQuery) {
    const collection=await this.collection(slug);const page=Math.max(1,Number(query.page??1));const pageSize=Number(query.pageSize??25);
    const where:Prisma.CollectionEntryWhereInput={collectionId:collection.id,...(query.stage?{stage:query.stage}:{}),entry:{...(query.q?{normalizedLemma:{contains:query.q.trim().toLowerCase()}}:{}),...(query.partOfSpeech?{partOfSpeech:query.partOfSpeech}:{})}};
    const [total,rows,positions]=await Promise.all([this.db.collectionEntry.count({where}),this.db.collectionEntry.findMany({where,skip:(page-1)*pageSize,take:pageSize,orderBy:[{sortOrder:'asc'},{dictionaryEntryId:'asc'}],include:{entry:{include:{definitions:true}}}}),this.db.collectionEntry.findMany({where:{collectionId:collection.id},select:{entry:{select:{partOfSpeech:true}}},distinct:['dictionaryEntryId']})]);
    const english=await this.english(rows.map(row=>row.entry));
    return {collection,page,pageSize,total,partsOfSpeech:[...new Set(positions.map(row=>row.entry.partOfSpeech))].sort(),stages:['Foundation','Core','Advanced'],
      words:rows.map(row=>({id:row.entry.id,lemma:row.entry.lemma,partOfSpeech:row.entry.partOfSpeech,stage:row.stage,...displayedDefinition(null,null,(query.language??'en').toLowerCase(),row.entry.definitions,english.get(row.entry.id)??null)}))};
  }
  private async user(cookie:string|undefined) {
    const user=await this.accounts.current(cookie);await this.dictionary.findAll(user.id);return user;
  }
  private async owned(userId:string,id:string) {
    const list=await this.db.userWordList.findFirst({where:{id,userId}});if(!list)throw new NotFoundException('Word list not found.');return list;
  }
  async lists(cookie:string|undefined) {
    const user=await this.user(cookie);await this.ensureReady();
    const rows=await this.db.userWordList.findMany({where:{userId:user.id},include:{_count:{select:{entries:true}}},orderBy:[{isDefault:'desc'},{createdAt:'asc'}]});
    const counts=await this.db.$queryRaw<{list_id:string;count:bigint}[]>`SELECT list_id,count(*) FROM user_words WHERE list_id IN (SELECT id FROM user_word_lists WHERE owner_id=${user.id}::uuid) GROUP BY list_id`;
    const legacy=new Map(counts.map(row=>[row.list_id,Number(row.count)]));
    return rows.map(({_count,...row})=>({...row,wordCount:_count.entries+(legacy.get(row.id)??0)}));
  }
  async createList(cookie:string|undefined,input:NewPersonalList) {
    const user=await this.user(cookie);
    return this.db.userWordList.findFirstOrThrow({where:{userId:user.id,isDefault:true}});
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
      const legacy=await tx.$queryRaw<{term:string}[]>`SELECT lower(term) AS term FROM user_words WHERE list_id=${id}::uuid`;
      const terms=new Set(legacy.map(row=>row.term));
      const candidates=rows.filter(row=>!terms.has(row.entry.normalizedLemma));
      const existing=await tx.wordListEntry.findMany({where:{wordListId:id,dictionaryEntryId:{in:candidates.map(row=>row.dictionaryEntryId)}},select:{dictionaryEntryId:true}});
      const identities=new Set(existing.map(row=>row.dictionaryEntryId));const fresh=candidates.filter(row=>!identities.has(row.dictionaryEntryId));
      if(preview)return {success:true,totalRequested:rows.length,added:fresh.length,skipped:rows.length-fresh.length,failed:0,preview:true};
      await tx.$executeRaw`INSERT INTO user_vocabulary_collections(user_id,collection_id) VALUES (${user.id}::uuid,${collection.id}::uuid) ON CONFLICT DO NOTHING`;
      const result=await tx.wordListEntry.createMany({data:fresh.map(row=>({wordListId:id,dictionaryEntryId:row.dictionaryEntryId,stage:row.stage,importedCollectionId:collection.id})),skipDuplicates:true});
      const added=await tx.wordListEntry.findMany({where:{wordListId:id,dictionaryEntryId:{in:fresh.map(row=>row.dictionaryEntryId)}},select:{id:true}});
      await tx.learningProgress.createMany({data:added.map(row=>({wordListEntryId:row.id})),skipDuplicates:true});
      return {success:true,totalRequested:rows.length,added:result.count,skipped:rows.length-result.count,failed:0};
    });
  }
  async entries(cookie:string|undefined,id:string,query:CollectionWordsQuery) {
    const user=await this.user(cookie);const list=await this.owned(user.id,id);const language=(query.language??list.preferredLanguage).toLowerCase();
    const rows=await this.db.wordListEntry.findMany({where:{wordListId:id},include:{entry:{include:{definitions:true}},progress:true},orderBy:{createdAt:'asc'}});
    const legacy=await this.db.$queryRaw<LegacyWord[]>`SELECT id,term,definition,part_of_speech,status,custom_language,familiarity,next_review_at,learning_stage FROM user_words WHERE list_id=${id}::uuid ORDER BY created_at`;
    const english=await this.english([...rows.map(row=>row.entry),...legacy.map(row=>({id:row.id,normalizedLemma:row.term.toLowerCase(),partOfSpeech:row.part_of_speech??''}))]);
    const normalized=rows.map(row=>({id:row.id,dictionaryEntryId:row.entry.id,lemma:row.entry.lemma,partOfSpeech:row.entry.partOfSpeech,stage:row.stage,customDefinition:row.customDefinition,customLanguage:row.customLanguage,familiarity:row.progress?.familiarity??0,nextReviewAt:row.progress?.nextReviewAt??null,...displayedDefinition(row.customDefinition,row.customLanguage,language,row.entry.definitions,english.get(row.entry.id)??null)}));
    const all=[...legacy.map(row=>({id:row.id,dictionaryEntryId:null,lemma:row.term,partOfSpeech:row.part_of_speech??'',stage:row.learning_stage,customDefinition:row.definition||null,customLanguage:row.custom_language,familiarity:row.status==='KNOWN'?Math.max(4,row.familiarity):Math.min(3,row.familiarity),nextReviewAt:row.next_review_at,...displayedDefinition(row.definition,row.custom_language,language,[],english.get(row.id)??null)})),...normalized]
      .filter(row=>(!query.q||row.lemma.toLowerCase().includes(query.q.trim().toLowerCase()))&&(!query.partOfSpeech||row.partOfSpeech===query.partOfSpeech)&&(!query.stage||row.stage===query.stage)&&(!query.review||!row.nextReviewAt||new Date(row.nextReviewAt)<=new Date()));
    const page=Math.max(1,Number(query.page??1)),pageSize=Number(query.pageSize??25);
    return {list,page,pageSize,total:all.length,words:all.slice((page-1)*pageSize,page*pageSize)};
  }
  async updateEntry(cookie:string|undefined,id:string,entryId:string,input:UpdatePersonalEntry) {
    if(!Object.keys(input).length)throw new BadRequestException('Change a definition or review setting.');
    const user=await this.user(cookie);await this.owned(user.id,id);
    const row=await this.db.wordListEntry.findFirst({where:{id:entryId,wordListId:id}});
    if(!row){
      const old=await this.db.$queryRaw<LegacyWord[]>`SELECT * FROM user_words WHERE id=${entryId}::uuid AND list_id=${id}::uuid`;
      if(!old.length)throw new NotFoundException('Personal entry not found.');
      await this.db.$executeRaw`UPDATE user_words SET definition=COALESCE(${input.customDefinition===undefined?null:input.customDefinition??''},definition),custom_language=CASE WHEN ${input.customLanguage!==undefined} THEN ${input.customLanguage??null} ELSE custom_language END,learning_stage=COALESCE(${input.stage??null},learning_stage),familiarity=COALESCE(${input.familiarity??null},familiarity),status=CASE WHEN ${input.familiarity!==undefined} THEN ${input.familiarity!==undefined&&input.familiarity>=4?'KNOWN':'UNFAMILIAR'} ELSE status END,next_review_at=CASE WHEN ${input.nextReviewAt!==undefined} THEN ${input.nextReviewAt?new Date(input.nextReviewAt):null} ELSE next_review_at END WHERE id=${entryId}::uuid AND list_id=${id}::uuid`;
      return {success:true};
    }
    return this.db.wordListEntry.update({where:{id:row.id},data:{...(input.customDefinition!==undefined?{customDefinition:input.customDefinition?.trim()||null}:{}),...(input.customLanguage!==undefined?{customLanguage:input.customLanguage?.toLowerCase()||null}:{}),...(input.stage?{stage:input.stage}:{}),...((input.familiarity!==undefined||input.nextReviewAt!==undefined)?{progress:{upsert:{create:{familiarity:input.familiarity??0,nextReviewAt:input.nextReviewAt?new Date(input.nextReviewAt):null},update:{...(input.familiarity!==undefined?{familiarity:input.familiarity}:{}),...(input.nextReviewAt!==undefined?{nextReviewAt:input.nextReviewAt?new Date(input.nextReviewAt):null}:{})}}}}:{})}});
  }
  async gameWords(cookie:string|undefined,id:string,length:number) {
    const {words:all}=await this.entries(cookie,id,{page:'1',pageSize:String(Number.MAX_SAFE_INTEGER)});
    const words=[...new Set(all.filter(word=>word.definition&&word.lemma.length===length&&/^[a-z]+$/i.test(word.lemma)).map(word=>word.lemma.toLowerCase()))];
    if(!words.length)throw new BadRequestException('This word list has no playable words at this length.');return words;
  }
}
