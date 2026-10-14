import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../app.module';
import { AccountService } from '../accounts/account.service';
import { AccountMailService } from '../accounts/account-mail.service';
import { WordListRepository } from '../word-lists/word-list.repository';
import { CollectionsStorage } from './collections.storage';
const testUrl=process.env.TEST_DATABASE_URL;
describe.skipIf(!testUrl)('Vocabulary Collections with PostgreSQL',()=>{
  let app:Awaited<ReturnType<typeof NestFactory.create>>;
  let url:string;let headers:{cookie:string;'content-type':string};let other:{cookie:string;'content-type':string};let db:CollectionsStorage;let pool:Pool;
  beforeAll(async()=>{
    if(!new URL(testUrl!).pathname.startsWith('/lexiplay_test_'))throw new Error('Disposable test database required');
    vi.spyOn(ThrottlerGuard.prototype,'canActivate').mockResolvedValue(true);
    vi.stubEnv('DATABASE_URL',testUrl!);vi.spyOn(AccountMailService.prototype,'send').mockResolvedValue(undefined);
    app=await NestFactory.create(AppModule,{logger:false});app.setGlobalPrefix('api/v1');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));await app.listen(0,'127.0.0.1');url=(await app.getUrl())+'/api/v1';
    const account=await app.get(AccountService).register({username:'collections_'+randomBytes(5).toString('hex'),password:'password8'});
    const second=await app.get(AccountService).register({username:'other_'+randomBytes(5).toString('hex'),password:'password8'});
    headers={cookie:'lexiplay_session='+account.token,'content-type':'application/json'};other={cookie:'lexiplay_session='+second.token,'content-type':'application/json'};
    db=app.get(CollectionsStorage);pool=new Pool({connectionString:testUrl!});await app.get(WordListRepository).poolDictionaryEntries(['cover']);
    await pool.query(`INSERT INTO dictionary_words(term,definition,part_of_speech,senses) VALUES ('cover','To place over.',ARRAY['verb'],'[{"partOfSpeech":"verb","definitions":["To place over."]}]'),('analyse','To examine carefully.',ARRAY['verb'],'[{"partOfSpeech":"verb","definitions":["To examine carefully."]}]') ON CONFLICT(term) DO UPDATE SET definition=EXCLUDED.definition,senses=EXCLUDED.senses`);
  },30000);
  beforeEach(async()=>{
    const account=await app.get(AccountService).register({username:'single_'+randomBytes(5).toString('hex'),password:'password8'});
    headers={cookie:'lexiplay_session='+account.token,'content-type':'application/json'};
  });
  afterAll(async()=>{await pool?.end();await app?.close();vi.restoreAllMocks();vi.unstubAllEnvs();});
  const post=(path:string,body:unknown,auth=headers)=>fetch(url+path,{method:'POST',headers:auth,body:JSON.stringify(body)});
  async function create(name:string,preferredLanguage='en'){const response=await post('/word-lists',{name,preferredLanguage});expect(response.status).toBe(201);return response.json();}
  async function selected(slug:string,word:string){const response=await fetch(url+'/collections/'+slug+'/words?q='+word);expect(response.status).toBe(200);const data=await response.json();return data.words.find((row:{lemma:string})=>row.lemma===word);}
  it('shows only real counts, keeps exam categories independent, and labels missing datasets',async()=>{
    const catalog=await(await fetch(url+'/collections')).json();
    expect(catalog.find((c:{slug:string})=>c.slug==='cefr-a1')).toMatchObject({wordCount:898,author:'oxford_3000_5000',status:'available'});
    expect(catalog.find((c:{slug:string})=>c.slug==='cefr-c2')).toMatchObject({wordCount:978,familyCount:731,author:'LexiPlay; Octanove Labs',status:'available',source:'https://github.com/openlanguageprofiles/olp-en-cefrj',license:'CC-BY-SA-4.0'});
    expect(catalog.find((c:{slug:string})=>c.slug==='ielts-core')).toMatchObject({category:'IELTS',level:null,wordCount:0,status:'awaiting_data'});
    expect(await(await fetch(url+'/collections/categories')).json()).toEqual(['CEFR','IELTS','TOEFL']);
    const page=await(await fetch(url+'/collections/cefr-a2/words?partOfSpeech=verb&stage=Core&pageSize=5')).json();expect(page.words).toHaveLength(5);expect(page.words.every((w:{partOfSpeech:string;stage:string})=>w.partOfSpeech==='verb'&&w.stage==='Core')).toBe(true);
  });
  it('connects a saved C2 collection to its actual gaming pool without an Oxford alias',async()=>{
    expect((await post('/collections/cefr-c2/save',{})).status).toBe(201);
    const added=await(await fetch(url+'/word-lists/pools/added',{headers})).json();
    expect(added).toEqual([expect.objectContaining({id:'lexiplay-c2',level:'C2',wordCount:942,familyCount:731})]);
    const words=await(await fetch(url+'/collections/cefr-c2/words?pageSize=5')).json();
    expect(words.total).toBe(978);
    expect(words.words).toHaveLength(5);
  });
  it('downloads a complete public family snapshot without embedding private membership',async()=>{
    const data=await(await fetch(url+'/collections/cefr-a2/snapshot',{headers})).json();
    expect(data.families).toHaveLength(data.total);
    expect(data.words).toHaveLength(793);
    expect(data.words.every((word:{inMyWordList:boolean})=>word.inMyWordList===false)).toBe(true);
    expect(new Set(data.families.flatMap((family:{memberIds:string[]})=>family.memberIds)).size).toBe(793);
    expect(data.collection.version).toBeTruthy();
  });
  it('paginates whole families, resolves only page definitions and preserves cross-level member labels',async()=>{
    const dictionary=vi.spyOn(app.get(WordListRepository),'poolDictionaryEntries');
    const response=await fetch(url+'/collections/cefr-a1/words?view=families&q=act&pageSize=25');
    expect(response.status).toBe(200);const data=await response.json();
    const family=data.families.find((family:{headword:string})=>family.headword==='act');
    expect(family.kind).toBe('family');
    expect(data.words.filter((word:{id:string})=>family.memberIds.includes(word.id)).map((word:{lemma:string})=>word.lemma)).toEqual(['action','actor','actress']);
    expect(family.relatedMembers).toContainEqual({lemma:'act',partsOfSpeech:['verb'],level:'A2'});
    expect(dictionary).toHaveBeenLastCalledWith([...new Set(data.words.map((word:{lemma:string})=>word.lemma))]);
    const first=await(await fetch(url+'/collections/cefr-a1/words?view=families&pageSize=1')).json();
    const second=await(await fetch(url+'/collections/cefr-a1/words?view=families&pageSize=1&page=2')).json();
    expect(first.pageUnit).toBe('family');expect(first.total).toBe(810);
    expect(first.families).toHaveLength(1);expect(second.families).toHaveLength(1);
    expect(first.families[0].id).not.toBe(second.families[0].id);
    dictionary.mockRestore();
  });
  it('previews imports, preserves review progress and rejects custom dictionary edits',async()=>{
    const list=await create('My academic words','zh');const word=await selected('cefr-a2','cover');const body={collectionId:'cefr-a2',selectedWordIds:[word.id],duplicatePolicy:'skip'};
    const preview=await(await post('/word-lists/'+list.id+'/import-collection/preview',body)).json();expect(preview).toMatchObject({added:1,skipped:0});expect(await db.wordListEntry.count({where:{wordListId:list.id}})).toBe(0);
    expect(await(await post('/word-lists/'+list.id+'/import-collection',body)).json()).toMatchObject({added:1,skipped:0,totalRequested:1});
    const membership=await(await fetch(url+'/collections/cefr-a2/words?q=cover',{headers})).json();expect(membership.words.find((w:{id:string})=>w.id===word.id).inMyWordList).toBe(true);
    const privateMembership=await(await fetch(url+'/collections/cefr-a2/words?q=cover',{headers:other})).json();expect(privateMembership.words.find((w:{id:string})=>w.id===word.id).inMyWordList).toBe(false);
    let entries=await(await fetch(url+'/word-lists/'+list.id+'/entries',{headers})).json();const entry=entries.words[0];expect(entry.definition).toBe('To place over.');
    const nextReviewAt='2030-01-01T12:00:00.000Z';const patch=await fetch(url+'/word-lists/'+list.id+'/entries/'+entry.id,{method:'PATCH',headers,body:JSON.stringify({familiarity:4,nextReviewAt})});expect(patch.status).toBe(200);
    const repeated=await(await post('/word-lists/'+list.id+'/import-collection',body)).json();expect(repeated).toMatchObject({added:0,skipped:1});
    entries=await(await fetch(url+'/word-lists/'+list.id+'/entries',{headers})).json();expect(entries.words[0]).toMatchObject({definition:'To place over.',language:'en',familiarity:4,nextReviewAt});
    expect((await pool.query("SELECT definition FROM dictionary_words WHERE term='cover'")).rows[0].definition).toBe('To place over.');
    expect(await db.dictionaryDefinition.count({where:{definition:'覆盖自己的理解'}})).toBe(0);
    const otherLists=await(await fetch(url+'/word-lists/mine',{headers:other})).json();expect(otherLists.some((l:{id:string})=>l.id===list.id)).toBe(false);
  });
  it('rejects empty, foreign, unauthorized and unavailable imports without inserting words',async()=>{
    const list=await create('Selection checks');const cover=await selected('cefr-a2','cover');const apple=await selected('cefr-a1','apple');
    expect((await post('/word-lists/'+list.id+'/import-collection',{collectionId:'cefr-a2',selectedWordIds:[]})).status).toBe(400);
    expect((await post('/word-lists/'+list.id+'/import-collection',{collectionId:'cefr-a2',selectedWordIds:null})).status).toBe(400);
    expect((await post('/word-lists/'+list.id+'/import-collection',{collectionId:'cefr-a2',selectedWordIds:[apple.id]})).status).toBe(400);
    expect((await post('/word-lists/'+list.id+'/import-collection',{collectionId:'cefr-a2',selectedWordIds:[cover.id]},other)).status).toBe(404);
    expect((await post('/word-lists/'+list.id+'/import-collection',{collectionId:'ielts-core'})).status).toBe(400);
    expect(await db.wordListEntry.count({where:{wordListId:list.id}})).toBe(0);
  });
  it('returns one overall list and saves official collections without copying entries',async()=>{
    const list=await create('Ignored custom list');const second=await create('Also ignored');expect(second.id).toBe(list.id);
    const before=await db.wordListEntry.count({where:{wordListId:list.id}});
    expect((await post('/collections/cefr-a1/save',{})).status).toBe(201);
    expect((await post('/collections/cefr-a1/save',{})).status).toBe(201);
    expect(await db.wordListEntry.count({where:{wordListId:list.id}})).toBe(before);
    const saved=await(await fetch(url+'/word-lists/collections',{headers})).json();expect(saved.filter((c:{slug:string})=>c.slug==='cefr-a1')).toHaveLength(1);
    const lists=await(await fetch(url+'/word-lists/mine',{headers})).json();expect(lists).toHaveLength(1);
  });
  it('excludes legacy custom words and imports canonical dictionary content independently',async()=>{
    const lists=await(await fetch(url+'/word-lists/mine',{headers})).json();const list=lists.find((l:{isDefault:boolean})=>l.isDefault);const analyse=await selected('cefr-b1','analyse');
    await pool.query("INSERT INTO user_words(list_id,term,definition,status) VALUES ($1,'analyse','分析一下问题','KNOWN') ON CONFLICT DO NOTHING",[list.id]);
    expect(await(await post('/word-lists/'+list.id+'/import-collection',{collectionId:'cefr-b1',selectedWordIds:[analyse.id]})).json()).toMatchObject({added:1,skipped:0});
    const entries=await(await fetch(url+'/word-lists/'+list.id+'/entries',{headers})).json();
    expect(entries.words).toHaveLength(1);expect(entries.words[0]).toMatchObject({lemma:'analyse',definition:'To examine carefully.',definitionSource:'dictionary'});
    expect((await pool.query("SELECT definition,status FROM user_words WHERE list_id=$1 AND term='analyse'",[list.id])).rows[0]).toEqual({definition:'分析一下问题',status:'KNOWN'});
  });
  it('adds dictionary matches to the same list, skips repeats and reports unknown words',async()=>{
    const list=await create('Dictionary tools');
    const body={terms:['cover','COVER','inventedwordzzzz']};
    const first=await post('/word-lists/'+list.id+'/dictionary-entries',body);expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({added:1,skipped:0,missing:['inventedwordzzzz']});
    expect(await(await post('/word-lists/'+list.id+'/dictionary-entries',body)).json()).toMatchObject({added:0,skipped:1});
    const entries=await(await fetch(url+'/word-lists/'+list.id+'/entries',{headers})).json();
    expect(entries.total).toBe(1);expect(entries.words[0]).toMatchObject({lemma:'cover',definition:'To place over.',definitionSource:'dictionary'});
    expect((await post('/word-lists/'+list.id+'/dictionary-entries',body,other)).status).toBe(404);
    expect((await post('/word-lists/'+list.id+'/dictionary-entries',{terms:[]})).status).toBe(400);
    expect((await post('/word-lists/'+list.id+'/dictionary-entries',{terms:['cover'],definition:'Private text'})).status).toBe(400);
    const patched=await fetch(url+'/word-lists/'+list.id+'/entries/'+entries.words[0].id,{method:'PATCH',headers,body:JSON.stringify({customDefinition:'Private text'})});expect(patched.status).toBe(400);
    await db.wordListEntry.update({where:{id:entries.words[0].id},data:{customDefinition:'Old custom text'}});
    const canonical=await(await fetch(url+'/word-lists/'+list.id+'/entries',{headers})).json();expect(canonical.words[0].definition).toBe('To place over.');
    const terms=await(await fetch(url+'/word-lists/saved-terms',{headers})).json();expect(terms.terms).toEqual(['cover']);
  });
  it('paginates before dictionary lookup and keeps search, counts, and page boundaries consistent',async()=>{
    const list=await create('Paged words');
    const source=await(await fetch(url+'/collections/cefr-a1/words?pageSize=100')).json();
    await post('/word-lists/'+list.id+'/import-collection',{collectionId:'cefr-a1',selectedWordIds:source.words.map((word:{id:string})=>word.id)});
    const lookup=vi.spyOn(app.get(WordListRepository),'poolDictionaryEntries');
    try{
      const first=await(await fetch(url+'/word-lists/'+list.id+'/entries?page=1&pageSize=5',{headers})).json();
      const second=await(await fetch(url+'/word-lists/'+list.id+'/entries?page=2&pageSize=5',{headers})).json();
      expect(first.total).toBe(100);expect(first.words).toHaveLength(5);expect(second.words).toHaveLength(5);
      expect(first.words.some((word:{id:string})=>second.words.some((other:{id:string})=>word.id===other.id))).toBe(false);
      expect(lookup.mock.calls.every(([terms])=>terms.length<=5)).toBe(true);
      const filtered=await(await fetch(url+'/word-lists/'+list.id+'/entries?q=about&partOfSpeech=adverb&pageSize=5',{headers})).json();
      expect(filtered.words.every((word:{lemma:string;partOfSpeech:string})=>word.lemma.includes('about')&&word.partOfSpeech==='adverb')).toBe(true);
    }finally{lookup.mockRestore();}
  });
  it('matches dictionary numerals to existing number entries without duplicates',async()=>{
    const list=await create('Numbers');
    await pool.query(`INSERT INTO dictionary_words(term,definition,part_of_speech,senses) VALUES ('one','The number 1.',ARRAY['numeral'],'[{"partOfSpeech":"numeral","definitions":["The number 1."]}]') ON CONFLICT(term) DO UPDATE SET definition=EXCLUDED.definition,senses=EXCLUDED.senses`);
    const entry=await db.dictionaryEntry.upsert({where:{normalizedLemma_partOfSpeech:{normalizedLemma:'one',partOfSpeech:'number'}},create:{lemma:'one',normalizedLemma:'one',partOfSpeech:'number'},update:{}});
    await db.wordListEntry.create({data:{wordListId:list.id,dictionaryEntryId:entry.id}});
    expect(await(await post('/word-lists/'+list.id+'/dictionary-entries',{terms:['one']})).json()).toMatchObject({added:0,skipped:1,missing:[]});
    const entries=await(await fetch(url+'/word-lists/'+list.id+'/entries',{headers})).json();expect(entries.total).toBe(1);expect(entries.words[0]).toMatchObject({definition:'The number 1.',partOfSpeech:'number'});
  });
  it('handles simultaneous imports idempotently and keeps different parts of speech distinct',async()=>{
    const cover=await selected('cefr-a2','cover');const list=await create('Concurrent import');const body={collectionId:'cefr-a2',selectedWordIds:[cover.id]};
    const responses=await Promise.all([post('/word-lists/'+list.id+'/import-collection',body),post('/word-lists/'+list.id+'/import-collection',body)]);
    const results=await Promise.all(responses.map(response=>response.json()));expect(results.map(result=>result.added).sort()).toEqual([0,1]);
    const noun=await db.dictionaryEntry.upsert({where:{normalizedLemma_partOfSpeech:{normalizedLemma:'cover',partOfSpeech:'noun'}},create:{lemma:'cover',normalizedLemma:'cover',partOfSpeech:'noun'},update:{}});
    await db.dictionaryDefinition.upsert({where:{dictionaryEntryId_language_senseIndex:{dictionaryEntryId:noun.id,language:'en',senseIndex:0}},create:{dictionaryEntryId:noun.id,language:'en',senseIndex:0,definition:'A lid.',source:'test-reviewed',reviewStatus:'approved'},update:{}});
    const collection=await db.vocabularyCollection.create({data:{slug:'test-multiple-pos-'+randomBytes(4).toString('hex'),name:'Multiple parts of speech',description:'Test fixture',category:'IELTS',version:'test',entries:{create:[{dictionaryEntryId:cover.id,stage:'Core',sortOrder:0},{dictionaryEntryId:noun.id,stage:'Advanced',sortOrder:1}]}}});
    const result=await(await post('/word-lists/'+list.id+'/import-collection',{collectionId:collection.slug})).json();expect(result).toMatchObject({added:1,skipped:1});
    const entries=await(await fetch(url+'/word-lists/'+list.id+'/entries',{headers})).json();expect(entries.words.map((word:{partOfSpeech:string})=>word.partOfSpeech).sort()).toEqual(['noun','verb']);
  });
  it('uses approved translations, falls back to live English and supports review and owned Wordle pools',async()=>{
    const list=await create('Review words','zh');const cover=await selected('cefr-a2','cover');await post('/word-lists/'+list.id+'/import-collection',{collectionId:'cefr-a2',selectedWordIds:[cover.id]});
    await db.dictionaryDefinition.upsert({where:{dictionaryEntryId_language_senseIndex:{dictionaryEntryId:cover.id,language:'zh',senseIndex:0}},create:{dictionaryEntryId:cover.id,language:'zh',senseIndex:0,definition:'覆盖',source:'test-reviewed',reviewStatus:'approved'},update:{definition:'覆盖',reviewStatus:'approved'}});
    let page=await(await fetch(url+'/word-lists/'+list.id+'/entries?review=due&language=zh',{headers})).json();expect(page.words[0]).toMatchObject({definition:'覆盖',language:'zh'});const entry=page.words[0];
    await fetch(url+'/word-lists/'+list.id+'/entries/'+entry.id,{method:'PATCH',headers,body:JSON.stringify({familiarity:3,nextReviewAt:'2030-01-01T12:00:00.000Z'})});
    page=await(await fetch(url+'/word-lists/'+list.id+'/entries?review=due&language=zh',{headers})).json();expect(page.total).toBe(0);
    const game=await post('/games',{wordListId:list.id,playWithMyWords:true,wordLength:5});expect(game.status).toBe(201);
    expect((await post('/games',{wordListId:list.id,playWithMyWords:true,wordLength:5},other)).status).toBe(404);
  });
});
