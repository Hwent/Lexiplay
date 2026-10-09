import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AccountService } from '../accounts/account.service';
import { SaveWordDto, UpdateWordDto } from './word-list.dto';
import { WordListRepository } from './word-list.repository';
import { ConfirmWordImportDto } from './word-list.dto';
import { WordListImportService } from './word-list-import';

@Injectable()
export class WordListsService {
  constructor(
    @Inject(WordListRepository) private readonly lists: WordListRepository,
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(WordListImportService) private readonly importer: WordListImportService,
  ) {}

  async list(cookie: string | undefined) {
    const user = await this.accounts.current(cookie);
    return this.lists.findAll(user.id);
  }

  async playableWords(cookie: string | undefined, wordLength: number) {
    const user = await this.accounts.current(cookie);
    const lists = await this.lists.findAll(user.id);
    return lists.flatMap(list => list.words.map(word => word.term))
      .filter(term => term.length === wordLength && /^[a-z]+$/.test(term));
  }

  async get(cookie: string | undefined, listId: string) {
    const user = await this.accounts.current(cookie);
    const list = await this.lists.find(user.id, listId);
    if (!list) throw new NotFoundException({ code: 'WORD_LIST_NOT_FOUND', message: 'This vocabulary list could not be found.' });
    return list;
  }

  async addWord(cookie: string | undefined, listId: string, input: SaveWordDto) {
    const user = await this.accounts.current(cookie);
    try {
      const word = await this.lists.addWord(user.id, listId, {
        term: input.term.trim().toLowerCase(),
        definition: input.definition?.trim() ?? '',
        partOfSpeech: input.partOfSpeech?.trim() || null,
        example: input.example?.trim() || null,
      });
      if (!word) throw new NotFoundException({ code: 'WORD_LIST_NOT_FOUND', message: 'This vocabulary list could not be found.' });
      return word;
    } catch (error) {
      this.throwForDuplicate(error);
    }
  }

  async searchDictionary(query: string) {
    const normalized = query.trim().toLowerCase();
    if (!/^[a-z][a-z '-]{0,99}$/.test(normalized)) {
      throw new BadRequestException({ code: 'INVALID_DICTIONARY_QUERY', message: 'Search for a word using letters, spaces, or hyphens.' });
    }
    return this.lists.searchDictionary(normalized);
  }

  async dictionaryDefinition(term: string) {
    try {
      const entries = await this.lists.searchDictionary(term, 1);
      return entries.find(entry => entry.term === term)?.definition ?? '';
    } catch {
      return '';
    }
  }

  async addDictionaryWord(cookie: string | undefined, listId: string, term: string) {
    const user = await this.accounts.current(cookie);
    const normalized = term.trim().toLowerCase();
    const word = await this.lists.addDictionaryWord(user.id, listId, normalized);
    if (!word) throw new NotFoundException({ code: 'DICTIONARY_WORD_NOT_FOUND', message: 'That dictionary word could not be found.' });
    return word;
  }

  async updateWord(cookie: string | undefined, listId: string, wordId: string, input: UpdateWordDto) {
    const user = await this.accounts.current(cookie);
    if (!Object.keys(input).length) throw new BadRequestException({ code: 'EMPTY_UPDATE', message: 'Change a word before saving.' });
    try {
      const word = await this.lists.updateWord(user.id, listId, wordId, {
        ...(input.term !== undefined ? { term: input.term.trim().toLowerCase() } : {}),
        ...(input.definition !== undefined ? { definition: input.definition.trim() } : {}),
        ...(input.partOfSpeech !== undefined ? { partOfSpeech: input.partOfSpeech.trim() || null } : {}),
        ...(input.example !== undefined ? { example: input.example.trim() || null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      });
      if (!word) throw new NotFoundException({ code: 'WORD_NOT_FOUND', message: 'This word could not be found.' });
      return word;
    } catch (error) {
      this.throwForDuplicate(error);
    }
  }

  async removeWord(cookie: string | undefined, listId: string, wordId: string) {
    const user = await this.accounts.current(cookie);
    if (!(await this.lists.removeWord(user.id, listId, wordId))) throw new NotFoundException({ code: 'WORD_NOT_FOUND', message: 'This word could not be found.' });
  }

  async previewImport(cookie: string | undefined, listId: string, file: { originalname: string; buffer: Buffer } | undefined) {
    if (!cookie) return this.importer.preview(file, []);
    const user = await this.accounts.current(cookie);
    const list = await this.lists.find(user.id, listId);
    if (!list) throw new NotFoundException({ code: 'WORD_LIST_NOT_FOUND', message: 'This vocabulary list could not be found.' });
    return this.importer.preview(file, list.words.map(word => word.term));
  }

  async confirmImport(cookie: string | undefined, listId: string, input: ConfirmWordImportDto) {
    const user = await this.accounts.current(cookie);
    const list = await this.lists.find(user.id, listId);
    if (!list) throw new NotFoundException({ code: 'WORD_LIST_NOT_FOUND', message: 'This vocabulary list could not be found.' });
    const selected = input.rows.filter(row => row.selected).map(row => ({
      term: row.term.trim().toLowerCase(),
      definition: row.definition.trim(),
      partOfSpeech: row.partOfSpeech?.trim() || null,
      example: row.example?.trim() || null,
    }));
    const repeated = new Set<string>();
    for (const word of selected) {
      if (repeated.has(word.term)) throw new BadRequestException({ code: 'DUPLICATE_IMPORT_ROW', message: `The preview contains ${word.term} more than once.` });
      repeated.add(word.term);
    }
    return this.lists.importWords(user.id, listId, selected);
  }

  private throwForDuplicate(error: unknown): never {
    if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
    if ((error as { code?: string }).code === '23505') {
      throw new ConflictException({ code: 'DUPLICATE_WORD', message: 'This word is already in the list.' });
    }
    throw error;
  }
}
