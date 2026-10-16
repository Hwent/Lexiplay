import { Body, Controller, Delete, Get, Headers, Inject, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { readSessionCookie } from '../accounts/session-cookie';
import { CollectionsService } from './collections.service';
import { AddDictionaryEntries, CollectionQuery, CollectionWordsQuery, GameCollectionsQuery, ImportCollection, NewPersonalList, UpdatePersonalEntry } from './collections.dto';
@Controller('library')
export class LibraryController {
  constructor(@Inject(CollectionsService) private readonly collections: CollectionsService) {}
  @Get('revision') revision() { return this.collections.revision(); }
}
@Controller('collections')
@UseGuards(ThrottlerGuard)
export class CollectionsController {
  constructor(@Inject(CollectionsService) private readonly collections: CollectionsService) {}
  @Get() catalog(@Query() query:CollectionQuery) { return this.collections.catalog(query.category); }
  @Get('categories') categories() { return this.collections.categories(); }
  @Get('game-options') gameOptions(@Query() query: GameCollectionsQuery) { return this.collections.gameOptions(Number(query.wordLength)); }
  @Post(':slug/save') save(@Headers('cookie') cookie:string|undefined,@Param('slug') slug:string) { return this.collections.saveCollection(readSessionCookie(cookie),slug); }
  @Delete(':slug/save') unsave(@Headers('cookie') cookie:string|undefined,@Param('slug') slug:string) { return this.collections.unsaveCollection(readSessionCookie(cookie),slug); }
  @Get(':slug/words') words(@Param('slug') slug:string,@Query() query:CollectionWordsQuery,@Headers('cookie') cookie?:string) { return this.collections.words(slug,query,cookie?.split(';').some(value=>value.trim().startsWith('lexiplay_session='))?readSessionCookie(cookie):undefined); }
  @Get(':slug/snapshot') snapshot(@Param('slug') slug:string) { return this.collections.snapshot(slug); }
  @Get(':slug') detail(@Param('slug') slug:string) { return this.collections.detail(slug); }
}
@Controller('word-lists')
@UseGuards(ThrottlerGuard)
export class PersonalCollectionsController {
  constructor(@Inject(CollectionsService) private readonly collections: CollectionsService) {}
  @Get('collections') saved(@Headers('cookie') cookie?:string) { return this.collections.savedCollections(readSessionCookie(cookie)); }
  @Get('mine') lists(@Headers('cookie') cookie?:string) { return this.collections.lists(readSessionCookie(cookie)); }
  @Get('saved-terms') savedTerms(@Headers('cookie') cookie?:string) { return this.collections.savedTerms(readSessionCookie(cookie)); }
  @Post() create(@Headers('cookie') cookie:string|undefined,@Body() input:NewPersonalList) { return this.collections.createList(readSessionCookie(cookie),input); }
  @Get(':id/entries') entries(@Headers('cookie') cookie:string|undefined,@Param('id',ParseUUIDPipe) id:string,@Query() query:CollectionWordsQuery) { return this.collections.entries(readSessionCookie(cookie),id,query); }
  @Post(':id/dictionary-entries') addDictionary(@Headers('cookie') cookie:string|undefined,@Param('id',ParseUUIDPipe) id:string,@Body() input:AddDictionaryEntries) { return this.collections.addDictionaryEntries(readSessionCookie(cookie),id,input); }
  @Patch(':id/entries/:entryId') update(@Headers('cookie') cookie:string|undefined,@Param('id',ParseUUIDPipe) id:string,@Param('entryId',ParseUUIDPipe) entryId:string,@Body() input:UpdatePersonalEntry) { return this.collections.updateEntry(readSessionCookie(cookie),id,entryId,input); }
  @Delete(':id/entries/:entryId') remove(@Headers('cookie') cookie:string|undefined,@Param('id',ParseUUIDPipe) id:string,@Param('entryId',ParseUUIDPipe) entryId:string) { return this.collections.removeEntry(readSessionCookie(cookie),id,entryId); }
  @Post(':id/import-collection/preview') preview(@Headers('cookie') cookie:string|undefined,@Param('id',ParseUUIDPipe) id:string,@Body() input:ImportCollection) { return this.collections.importCollection(readSessionCookie(cookie),id,input,true); }
  @Post(':id/import-collection') import(@Headers('cookie') cookie:string|undefined,@Param('id',ParseUUIDPipe) id:string,@Body() input:ImportCollection) { return this.collections.importCollection(readSessionCookie(cookie),id,input); }
}
