import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { WordListsService } from './word-lists.service';

@Controller('word-lists/dictionary')
@UseGuards(ThrottlerGuard)
export class WordListsController {
  constructor(@Inject(WordListsService) private readonly dictionary: WordListsService) {}
  @Get() search(@Query('q') query = '') { return this.dictionary.searchDictionary(query); }
  @Get(':term/definition') async definition(@Param('term') term: string) {
    return { definition: await this.dictionary.dictionaryDefinition(term) };
  }
}
