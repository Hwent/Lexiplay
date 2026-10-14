import { Body, Controller, Get, Headers, Inject, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { readSessionCookie } from '../accounts/session-cookie';
import { CollectionsService } from './collections.service';
import { CollectionQuery, CollectionWordsQuery, ImportCollection, NewPersonalList, UpdatePersonalEntry } from './collections.dto';
@Controller('collections')
@UseGuards(ThrottlerGuard)
export class CollectionsController {
  constructor(@Inject(CollectionsService) private readonly collections: CollectionsService) {}
  @Get() catalog(@Query() query:CollectionQuery) { return this.collections.catalog(query.category); }
  @Get('categories') categories() { return this.collections.categories(); }
  @Post(':slug/save') save(@Headers('cookie') cookie:string|undefined,@Param('slug') slug:string) { return this.collections.saveCollection(readSessionCookie(cookie),slug); }
  @Get(':slug/words') words(@Param('slug') slug:string,@Query() query:CollectionWordsQuery) { return this.collections.words(slug,query); }
  @Get(':slug') detail(@Param('slug') slug:string) { return this.collections.detail(slug); }
}
@Controller('word-lists')
@UseGuards(ThrottlerGuard)
export class PersonalCollectionsController {
  constructor(@Inject(CollectionsService) private readonly collections: CollectionsService) {}
  @Get('collections') saved(@Headers('cookie') cookie?:string) { return this.collections.savedCollections(readSessionCookie(cookie)); }
  @Get('mine') lists(@Headers('cookie') cookie?:string) { return this.collections.lists(readSessionCookie(cookie)); }
  @Post() create(@Headers('cookie') cookie:string|undefined,@Body() input:NewPersonalList) { return this.collections.createList(readSessionCookie(cookie),input); }
  @Get(':id/entries') entries(@Headers('cookie') cookie:string|undefined,@Param('id',ParseUUIDPipe) id:string,@Query() query:CollectionWordsQuery) { return this.collections.entries(readSessionCookie(cookie),id,query); }
  @Patch(':id/entries/:entryId') update(@Headers('cookie') cookie:string|undefined,@Param('id',ParseUUIDPipe) id:string,@Param('entryId',ParseUUIDPipe) entryId:string,@Body() input:UpdatePersonalEntry) { return this.collections.updateEntry(readSessionCookie(cookie),id,entryId,input); }
  @Post(':id/import-collection/preview') preview(@Headers('cookie') cookie:string|undefined,@Param('id',ParseUUIDPipe) id:string,@Body() input:ImportCollection) { return this.collections.importCollection(readSessionCookie(cookie),id,input,true); }
  @Post(':id/import-collection') import(@Headers('cookie') cookie:string|undefined,@Param('id',ParseUUIDPipe) id:string,@Body() input:ImportCollection) { return this.collections.importCollection(readSessionCookie(cookie),id,input); }
}
