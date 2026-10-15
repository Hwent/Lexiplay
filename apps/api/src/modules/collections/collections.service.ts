import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AccountService } from '../accounts/account.service';
import { CollectionsStorage } from './collections.storage';
import { AddDictionaryEntries, CollectionWordsQuery, ImportCollection, NewPersonalList, UpdatePersonalEntry } from './collections.dto';
import { Prisma } from '../../generated/prisma/client';

const entryInclude = { word: { include: { family: true } }, definitions: { orderBy: { senseOrder: 'asc' as const } } };
const collectionInclude = { entries: { orderBy: [{ sortOrder: 'asc' as const }, { dictionaryEntryId: 'asc' as const }], include: { entry: { include: entryInclude } } } };
type Collection = Prisma.VocabularyCollectionGetPayload<{ include: typeof collectionInclude }>;
type Entry = Collection['entries'][number]['entry'];

@Injectable()
export class CollectionsService {
  constructor(@Inject(CollectionsStorage) private readonly db: CollectionsStorage,
    @Inject(AccountService) private readonly accounts: AccountService) {}

  private summary(collection: Collection) {
    const families = new Map(collection.entries.map(row => [row.entry.word.familyId ?? 'item:' + row.entry.wordId, !!row.entry.word.familyId]));
    const familyCount = [...families.values()].filter(Boolean).length;
    return { id: collection.id, slug: collection.slug, name: collection.name, description: collection.description,
      category: collection.category, level: collection.category === 'CEFR' ? collection.slug.slice(5).toUpperCase() : null,
      author: collection.author, source: collection.sourceUrl, license: collection.license,
      version: collection.revisionId + ':' + (collection.entries[0]?.entry.word.revisionId ?? ''),
      status: collection.status, wordCount: collection.entries.length, memberCount: collection.entries.length,
      ...(collection.status === 'available' ? { familyCount, otherUnitCount: families.size - familyCount } : {}) };
  }

  private definition(entry: Entry) {
    const definition = entry.word.retiredAt || entry.retiredAt ? null : entry.definitions.map(row => row.definition).join('; ') || null;
    return { definition, language: definition ? 'en' : null, definitionSource: definition ? 'dictionary' : null };
  }

  async categories() {
    const rows = await this.db.vocabularyCollection.findMany({ distinct: ['category'], select: { category: true }, orderBy: { category: 'asc' } });
    return rows.map(row => row.category);
  }

  async revision() {
    const rows = await this.db.libraryRevision.findMany({ where: { isCurrent: true }, select: { id: true, scope: true }, orderBy: { scope: 'asc' } });
    return { version: rows.map(row => row.scope + ':' + row.id).join('|') };
  }

  async catalog(category?: string) {
    const rows = await this.db.vocabularyCollection.findMany({ where: { ...(category ? { category } : {}), status: { not: 'retired' } },
      include: collectionInclude, orderBy: [{ category: 'asc' }, { slug: 'asc' }] });
    return rows.map(row => this.summary(row));
  }

  private async collection(slug: string) {
    const where = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(slug) ? { OR: [{ id: slug }, { slug }] } : { slug };
    const collection = await this.db.vocabularyCollection.findFirst({ where, include: collectionInclude });
    if (!collection) throw new NotFoundException('Vocabulary collection not found.');
    return collection;
  }

  async detail(slug: string) { return this.summary(await this.collection(slug)); }
  async snapshot(slug: string) { return this.words(slug, { view: 'families', pageSize: '10000' }); }

  async words(slug: string, query: CollectionWordsQuery, cookie?: string) {
    const collection = await this.collection(slug);
    const page = Math.max(1, Number(query.page ?? 1)), pageSize = Number(query.pageSize ?? 25);
    const search = query.q?.trim().toLowerCase();
    const filtered = collection.entries.filter(row => (!query.stage || row.stage === query.stage)
      && (!query.partOfSpeech || row.entry.partOfSpeech === query.partOfSpeech)
      && (!search || row.entry.word.term.toLowerCase().includes(search) || row.entry.word.family?.headword.toLowerCase().includes(search)));
    const groups = new Map<string, { id: string; headword: string; kind: 'family' | 'phrase' | 'unclassified'; rows: typeof filtered }>();
    for (const row of filtered) {
      const word = row.entry.word, id = word.familyId ?? 'item:' + word.id;
      const group = groups.get(id) ?? { id, headword: word.family?.headword ?? word.term,
        kind: word.familyId ? 'family' : /\s/.test(word.term) ? 'phrase' : 'unclassified', rows: [] };
      group.rows.push(row); groups.set(id, group);
    }
    const familyView = query.view === 'families';
    const selected = [...groups.values()].slice((page - 1) * pageSize, page * pageSize);
    const rows = familyView ? selected.flatMap(group => group.rows) : filtered.slice((page - 1) * pageSize, page * pageSize);
    const saved = cookie ? await this.savedTerms(cookie) : { entryIds: [] };
    const savedIds = new Set(saved.entryIds);
    const words = rows.map(row => ({ id: row.entry.id, lemma: row.entry.word.term, partOfSpeech: row.entry.partOfSpeech,
      stage: row.stage, inMyWordList: savedIds.has(row.entry.id), ...this.definition(row.entry) }));
    const familyIds = selected.filter(group => group.kind === 'family').map(group => group.id);
    const related = familyView && familyIds.length ? await this.db.collectionEntry.findMany({
      where: { collectionId: { not: collection.id }, entry: { word: { familyId: { in: familyIds } } } },
      include: { collection: true, entry: { include: { word: true } } },
    }) : [];
    return { collection: this.summary(collection), page, pageSize, total: familyView ? groups.size : filtered.length,
      partsOfSpeech: [...new Set(collection.entries.map(row => row.entry.partOfSpeech))].sort(),
      stages: ['Foundation', 'Core', 'Advanced'], words,
      ...(familyView ? { memberTotal: filtered.length, pageUnit: 'family', families: selected.map(group => {
        const members = new Map<string, { lemma: string; partsOfSpeech: string[]; level: string }>();
        for (const row of related) {
          if (row.entry.word.familyId !== group.id) continue;
          const level = row.collection.category === 'CEFR' ? row.collection.slug.slice(5).toUpperCase() : row.collection.name;
          const key = row.entry.wordId + ':' + row.collectionId;
          const member = members.get(key) ?? { lemma: row.entry.word.term, partsOfSpeech: [], level };
          member.partsOfSpeech.push(row.entry.partOfSpeech); members.set(key, member);
        }
        return { id: group.id, headword: group.headword, kind: group.kind, memberIds: group.rows.map(row => row.entry.id), relatedMembers: [...members.values()] };
      }) } : {}) };
  }

  private async owned(cookie: string | undefined, id: string) {
    const user = await this.accounts.current(cookie);
    if (id !== user.id) throw new NotFoundException('Word list not found.');
    return user;
  }

  async lists(cookie: string | undefined) {
    const user = await this.accounts.current(cookie);
    const wordCount = await this.db.userWord.count({ where: { userId: user.id, status: 'active' } });
    return [{ id: user.id, name: 'My Word List', isDefault: true, preferredLanguage: 'en', wordCount }];
  }

  async createList(cookie: string | undefined, _input: NewPersonalList) { return (await this.lists(cookie))[0]!; }

  async savedTerms(cookie: string | undefined) {
    const user = await this.accounts.current(cookie);
    const rows = await this.db.userWord.findMany({ where: { userId: user.id, status: 'active' }, include: { entry: { include: { word: true } } } });
    return { terms: [...new Set(rows.map(row => row.entry.word.term))], entryIds: rows.map(row => row.dictionaryEntryId) };
  }

  async savedCollections(cookie: string | undefined) {
    const user = await this.accounts.current(cookie);
    const rows = await this.db.userVocabularyCollection.findMany({ where: { userId: user.id }, include: { collection: { include: collectionInclude } }, orderBy: { savedAt: 'asc' } });
    return rows.map(row => this.summary(row.collection));
  }

  async saveCollection(cookie: string | undefined, slug: string) {
    const user = await this.accounts.current(cookie), collection = await this.collection(slug);
    if (collection.status !== 'available') throw new BadRequestException('This collection is awaiting source data.');
    await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM account_users WHERE id=${user.id}::uuid FOR UPDATE`;
      await tx.userVocabularyCollection.upsert({ where: { userId_collectionId: { userId: user.id, collectionId: collection.id } },
        create: { userId: user.id, collectionId: collection.id }, update: {} });
      await tx.userWord.createMany({ data: collection.entries.map(row => ({ userId: user.id, dictionaryEntryId: row.dictionaryEntryId, stage: row.stage })), skipDuplicates: true });
    });
    return { success: true };
  }

  async unsaveCollection(cookie: string | undefined, slug: string) {
    const user = await this.accounts.current(cookie), collection = await this.collection(slug);
    await this.db.userVocabularyCollection.deleteMany({ where: { userId: user.id, collectionId: collection.id } });
    return { success: true };
  }

  private async addEntries(tx: Prisma.TransactionClient, userId: string, ids: string[], preview = false) {
    const existing = await tx.userWord.count({ where: { userId, dictionaryEntryId: { in: ids }, status: 'active' } });
    if (!preview) {
      await tx.userWord.createMany({ data: ids.map(dictionaryEntryId => ({ userId, dictionaryEntryId })), skipDuplicates: true });
      await tx.userWord.updateMany({ where: { userId, dictionaryEntryId: { in: ids }, status: 'excluded' }, data: { status: 'active', updatedAt: new Date() } });
    }
    return { success: true, totalRequested: ids.length, added: ids.length - existing, skipped: existing, failed: 0, ...(preview ? { preview: true } : {}) };
  }

  async importCollection(cookie: string | undefined, id: string, input: ImportCollection, preview = false) {
    const user = await this.owned(cookie, id), collection = await this.collection(input.collectionId);
    if (collection.status !== 'available') throw new BadRequestException('This collection is awaiting source data.');
    const selected = input.selectedWordIds ? new Set(input.selectedWordIds) : undefined;
    const ids = collection.entries.filter(row => !selected || selected.has(row.dictionaryEntryId)).map(row => row.dictionaryEntryId);
    if ((selected && (!selected.size || selected.size !== ids.length))) throw new BadRequestException('Every selected word must belong to this collection.');
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM account_users WHERE id=${user.id}::uuid FOR UPDATE`;
      return this.addEntries(tx, user.id, ids, preview);
    });
  }

  async addDictionaryEntries(cookie: string | undefined, id: string, input: AddDictionaryEntries) {
    const user = await this.owned(cookie, id);
    const terms = [...new Set(input.terms.map(term => term.trim()))];
    if (terms.some(term => !term)) throw new BadRequestException('Enter a word for every row.');
    const words = await this.db.dictionaryWord.findMany({ where: { term: { in: terms, mode: 'insensitive' }, retiredAt: null },
      include: { entries: { where: { retiredAt: null, definitions: { some: {} } }, select: { id: true } } } });
    const ids = new Set<string>(), missing: string[] = [];
    for (const term of terms) {
      const exact = words.find(word => word.term === term);
      const alternatives = words.filter(word => word.term.toLowerCase() === term.toLowerCase());
      const word = exact ?? (alternatives.length === 1 ? alternatives[0] : undefined);
      if (!word?.entries.length) missing.push(term);
      else for (const entry of word.entries) ids.add(entry.id);
    }
    const result = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM account_users WHERE id=${user.id}::uuid FOR UPDATE`;
      return this.addEntries(tx, user.id, [...ids]);
    });
    return { ...result, missing };
  }

  async entries(cookie: string | undefined, id: string, query: CollectionWordsQuery) {
    const user = await this.owned(cookie, id);
    const page = Math.max(1, Number(query.page ?? 1)), pageSize = Number(query.pageSize ?? 25);
    const where: Prisma.UserWordWhereInput = { userId: user.id, status: 'active',
      ...(query.stage ? { stage: query.stage } : {}),
      ...(query.q || query.partOfSpeech ? { entry: { ...(query.partOfSpeech ? { partOfSpeech: query.partOfSpeech } : {}),
        ...(query.q ? { word: { term: { contains: query.q.trim(), mode: 'insensitive' } } } : {}) } } : {}),
      ...(query.review ? { OR: [{ nextReviewAt: null }, { nextReviewAt: { lte: new Date() } }] } : {}) };
    const [total, rows] = await Promise.all([this.db.userWord.count({ where }), this.db.userWord.findMany({
      where, skip: (page - 1) * pageSize, take: pageSize, include: { entry: { include: entryInclude } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })]);
    const words = rows.map(row => ({ id: row.id, dictionaryEntryId: row.dictionaryEntryId, lemma: row.entry.word.term,
      partOfSpeech: row.entry.partOfSpeech, stage: row.stage, familiarity: row.familiarity, nextReviewAt: row.nextReviewAt,
      ...this.definition(row.entry) }));
    return { list: { id: user.id, name: 'My Word List', preferredLanguage: 'en', isDefault: true }, page, pageSize, total, words };
  }

  async updateEntry(cookie: string | undefined, id: string, entryId: string, input: UpdatePersonalEntry) {
    const user = await this.owned(cookie, id);
    if (!Object.keys(input).length) throw new BadRequestException('Change a review setting.');
    const changed = await this.db.userWord.updateMany({ where: { id: entryId, userId: user.id, status: 'active' },
      data: { ...(input.stage ? { stage: input.stage } : {}), ...(input.familiarity !== undefined ? { familiarity: input.familiarity } : {}),
        ...(input.nextReviewAt !== undefined ? { nextReviewAt: input.nextReviewAt ? new Date(input.nextReviewAt) : null } : {}), updatedAt: new Date() } });
    if (!changed.count) throw new NotFoundException('Personal entry not found.');
    return { success: true };
  }

  async removeEntry(cookie: string | undefined, id: string, entryId: string) {
    const user = await this.owned(cookie, id);
    const changed = await this.db.userWord.updateMany({ where: { id: entryId, userId: user.id }, data: { status: 'excluded', updatedAt: new Date() } });
    if (!changed.count) throw new NotFoundException('Personal entry not found.');
    return { success: true };
  }

  async gameWords(cookie: string | undefined, id: string, length: number) {
    const user = await this.owned(cookie, id);
    const rows = await this.db.userWord.findMany({ where: { userId: user.id, status: 'active',
      entry: { retiredAt: null, word: { retiredAt: null }, definitions: { some: {} } } }, include: { entry: { include: { word: true } } } });
    const words = [...new Set(rows.map(row => row.entry.word.term.toLowerCase()).filter(term => term.length === length && /^[a-z]+$/.test(term)))];
    if (!words.length) throw new BadRequestException('This word list has no playable words at this length.');
    return words;
  }

  async collectionGameWords(slug: string, length: number) {
    const collection = await this.collection(slug);
    const words = [...new Set(collection.entries.filter(row => this.definition(row.entry).definition)
      .map(row => row.entry.word.term.toLowerCase()).filter(term => term.length === length && /^[a-z]+$/.test(term)))];
    if (!words.length) throw new BadRequestException('This collection has no playable words at this length.');
    return { words, collection: this.summary(collection) };
  }
}
