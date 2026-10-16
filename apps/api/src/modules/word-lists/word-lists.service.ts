import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
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
  async dictionarySynonym(term: string): Promise<string | undefined> {
    try {
      for (const relation of ['rel_syn', 'rel_spc']) {
        const query = new URLSearchParams({ [relation]: term, max: '10' });
        const response = await fetch('https://api.datamuse.com/words?' + query, { signal: AbortSignal.timeout(3000) });
        if (!response.ok) throw new Error('Word clue lookup failed');
        const words: unknown = await response.json();
        if (!Array.isArray(words)) throw new Error('Invalid word clue response');
        const word = words.find(item => typeof item?.word === 'string' && item.word.trim()
          && item.word.length <= 100 && !new RegExp(`\\b${term}\\b`, 'i').test(item.word))?.word.trim();
        if (word) return relation === 'rel_syn' ? word : 'Category: ' + word;
      }
      return undefined;
    } catch {
      throw new ServiceUnavailableException('Word clue lookup is unavailable. No coins were charged.');
    }
  }
  dictionaryGameWords(length: number) { return this.dictionary.dictionaryGameWords(length); }
  isDictionaryGameWord(term: string) { return this.dictionary.isDictionaryGameWord(term); }
}
