import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ThrottlerGuard } from '@nestjs/throttler';
import { readSessionCookie } from '../accounts/session-cookie';
import { AddDictionaryWordDto, ConfirmWordImportDto, SaveWordDto, UpdateWordDto } from './word-list.dto';
import { WordListsService } from './word-lists.service';

@Controller('word-lists')
@UseGuards(ThrottlerGuard)
export class WordListsController {
  constructor(@Inject(WordListsService) private readonly lists: WordListsService) {}

  @Get()
  list(@Headers('cookie') cookie: string | undefined) {
    return this.lists.list(readSessionCookie(cookie));
  }

  @Get('dictionary')
  searchDictionary(@Headers('cookie') cookie: string | undefined, @Query('q') query = '') {
    return this.lists.searchDictionary(readSessionCookie(cookie), query);
  }

  @Post(':listId/dictionary')
  addDictionaryWord(@Headers('cookie') cookie: string | undefined, @Param('listId', ParseUUIDPipe) listId: string, @Body() input: AddDictionaryWordDto) {
    return this.lists.addDictionaryWord(readSessionCookie(cookie), listId, input.term);
  }

  @Get(':listId')
  get(@Headers('cookie') cookie: string | undefined, @Param('listId', ParseUUIDPipe) listId: string) {
    return this.lists.get(readSessionCookie(cookie), listId);
  }

  @Post(':listId/words')
  addWord(@Headers('cookie') cookie: string | undefined, @Param('listId', ParseUUIDPipe) listId: string, @Body() input: SaveWordDto) {
    return this.lists.addWord(readSessionCookie(cookie), listId, input);
  }

  @Patch(':listId/words/:wordId')
  updateWord(@Headers('cookie') cookie: string | undefined, @Param('listId', ParseUUIDPipe) listId: string, @Param('wordId', ParseUUIDPipe) wordId: string, @Body() input: UpdateWordDto) {
    return this.lists.updateWord(readSessionCookie(cookie), listId, wordId, input);
  }

  @Delete(':listId/words/:wordId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeWord(@Headers('cookie') cookie: string | undefined, @Param('listId', ParseUUIDPipe) listId: string, @Param('wordId', ParseUUIDPipe) wordId: string) {
    return this.lists.removeWord(readSessionCookie(cookie), listId, wordId);
  }

  @Post(':listId/import-preview')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  previewImport(@Headers('cookie') cookie: string | undefined, @Param('listId', ParseUUIDPipe) listId: string, @UploadedFile() file?: { originalname: string; buffer: Buffer }) {
    return this.lists.previewImport(readSessionCookie(cookie), listId, file);
  }

  @Post(':listId/import')
  confirmImport(@Headers('cookie') cookie: string | undefined, @Param('listId', ParseUUIDPipe) listId: string, @Body() input: ConfirmWordImportDto) {
    return this.lists.confirmImport(readSessionCookie(cookie), listId, input);
  }
}
