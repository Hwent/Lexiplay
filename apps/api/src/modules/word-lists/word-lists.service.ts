import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { WordListRepository } from './word-list.repository';

@Injectable()
export class WordListsService {
  constructor(@Inject(WordListRepository) private readonly dictionary: WordListRepository) {}

  async searchDictionary(query: string) {
    const term = query.trim();
    if (!term || term.length > 100 || /[\u0000-\u001f]/.test(term)) {
      throw new BadRequestException({ code: 'INVALID_DICTIONARY_QUERY', message: 'Enter a dictionary search of 1 to 100 characters.' });
    }
    return this.dictionary.searchDictionary(term);
  }

  dictionaryDefinition(term: string) { return this.dictionary.getDictionaryDefinition(term); }
  async dictionaryPartOfSpeech(term: string): Promise<string | undefined> {
    const entries = await this.dictionary.poolDictionaryEntries([term]);
    const classes = entries.flatMap(entry => entry.partOfSpeech)
      .map(value => value.trim()).filter(value => value && value !== 'unknown');
    return [...new Set(classes)].join(' · ') || undefined;
  }
  dictionaryGameWords(length: number) { return this.dictionary.dictionaryGameWords(length); }
  isDictionaryGameWord(term: string) { return this.dictionary.isDictionaryGameWord(term); }
}
