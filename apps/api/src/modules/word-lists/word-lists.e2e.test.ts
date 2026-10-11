import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { afterEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { AccountService } from '../accounts/account.service';
import { WordListsController } from './word-lists.controller';
import { WordListRepository } from './word-list.repository';
import { WordListImportService } from './word-list-import';
import { WordListsService } from './word-lists.service';

function pdfWithText(text: string): Buffer {
  const stream = `BT /F1 12 Tf 30 240 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let content = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(content, 'ascii'));
    content += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(content, 'ascii');
  content += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(content, 'ascii');
}

class MemoryWordListRepository {
  private nextId = 1;
  private lists: Array<{ id: string; ownerId: string; name: string; words: Array<{ id: string; term: string; definition: string; partOfSpeech?: string | null; status: 'KNOWN' | 'UNFAMILIAR' }> }> = [];

  private uuid(prefix: number) { return `00000000-0000-4000-8000-${String(prefix).padStart(12, '0')}`; }

  async findAll(ownerId: string) { return [await this.ensureDefaultList(ownerId)]; }
  async ensureDefaultList(ownerId: string) { return this.lists.find(list => list.ownerId === ownerId) ?? this.create(ownerId); }
  async find(ownerId: string, id: string) { return this.lists.find(list => list.ownerId === ownerId && list.id === id) ?? null; }
  async create(ownerId: string) {
    const existing = this.lists.find(list => list.ownerId === ownerId);
    if (existing) return existing;
    const list = { id: this.uuid(this.nextId++), ownerId, name: 'My words', words: [] as Array<{ id: string; term: string; definition: string; partOfSpeech?: string | null; status: 'KNOWN' | 'UNFAMILIAR' }> };
    this.lists.push(list);
    return list;
  }
  async addWord(ownerId: string, listId: string, word: { term: string; definition: string; partOfSpeech?: string | null }) {
    const list = await this.find(ownerId, listId);
    if (!list) return null;
    const saved = { id: this.uuid(this.nextId++), ...word, status: 'UNFAMILIAR' as const };
    list.words.push(saved);
    return saved;
  }
  async searchDictionary(query: string) {
    if (query === 'apple') return [{ term: 'apple', partOfSpeech: ['noun'] }];
    if (query === 'longword') return [{ term: 'longword', partOfSpeech: ['noun'] }];
    return [];
  }
  async getDictionaryDefinition(term: string) {
    if (term === 'apple') return 'The round fruit of a tree of the rose family.';
    if (term === 'longword') return 'A'.repeat(650);
    return '';
  }
  async addDictionaryWord(ownerId: string, listId: string, term: string) {
    const entry = (await this.searchDictionary(term)).find(item => item.term === term);
    if (!entry) return null;
    const definition = await this.getDictionaryDefinition(term);
    const list = await this.find(ownerId, listId);
    if (!list) return null;
    const existing = list.words.find(word => word.term === term);
    if (existing) return existing;
    const savedDefinition = definition.length > 500 ? `${definition.slice(0, 499)}…` : definition;
    const saved = { id: this.uuid(this.nextId++), term, definition: savedDefinition, partOfSpeech: 'noun', status: 'UNFAMILIAR' as const };
    list.words.push(saved);
    return saved;
  }
  async importWords(ownerId: string, listId: string, words: { term: string; definition: string; partOfSpeech?: string }[]) {
    const list = await this.find(ownerId, listId);
    if (!list) return { added: 0, duplicates: 0 };
    let added = 0;
    let duplicates = 0;
    for (const word of words) {
      if (list.words.some(item => item.term === word.term)) { duplicates++; continue; }
      list.words.push({ id: this.uuid(this.nextId++), ...word, status: 'UNFAMILIAR' });
      added++;
    }
    return { added, duplicates };
  }
  async updateWord(ownerId: string, listId: string, wordId: string, patch: { term?: string; definition?: string; status?: 'KNOWN' | 'UNFAMILIAR' }) {
    const list = await this.find(ownerId, listId);
    const word = list?.words.find(item => item.id === wordId);
    if (!word) return null;
    Object.assign(word, patch);
    return word;
  }
  async removeWord(ownerId: string, listId: string, wordId: string) {
    const list = await this.find(ownerId, listId);
    const index = list?.words.findIndex(item => item.id === wordId) ?? -1;
    if (!list || index < 0) return false;
    list.words.splice(index, 1);
    return true;
  }
}

describe('owned vocabulary list HTTP endpoints', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('lets an owner manage lists and words while hiding another user’s lists', async () => {
    const repository = new MemoryWordListRepository();
    const ownerToken = 'A'.repeat(43);
    const otherToken = 'B'.repeat(43);
    @Module({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }])],
      controllers: [WordListsController],
      providers: [
        WordListsService,
        WordListImportService,
        { provide: WordListRepository, useValue: repository },
        { provide: AccountService, useValue: { current: async (token: string) => ({ id: token === ownerToken ? 'user-1' : 'user-2', email: 'learner@example.test' }) } },
      ],
    })
    class WordListsHttpTestModule {}

    app = await NestFactory.create(WordListsHttpTestModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new (await import('@nestjs/common')).ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const baseUrl = `${await app.getUrl()}/api/v1/word-lists`;
    const headers = { 'content-type': 'application/json', cookie: `lexiplay_session=${ownerToken}` };

    const localFile = new FormData();
    localFile.append('file', new Blob(['peach: A fuzzy fruit'], { type: 'text/plain' }), 'words.txt');
    const localPreview = await fetch(`${baseUrl}/00000000-0000-4000-8000-000000000001/import-preview`, { method: 'POST', body: localFile });
    expect(localPreview.status).toBe(200);
    expect(await localPreview.json()).toMatchObject({ rows: [expect.objectContaining({ term: 'peach', definition: 'A fuzzy fruit' })] });

    const listsResponse = await fetch(baseUrl, { headers });
    expect(listsResponse.status).toBe(200);
    const list = (await listsResponse.json() as { id: string; name: string }[])[0]!;
    expect(list).toMatchObject({ name: 'My words' });
    expect(Object.hasOwn(list, 'description')).toBe(false);
    expect(await (await fetch(baseUrl, { headers })).json()).toMatchObject([{ id: list.id }]);

    const dictionary = await fetch(`${baseUrl}/dictionary?q=apple`);
    expect(await dictionary.json()).toEqual([{ term: 'apple', partOfSpeech: ['noun'] }]);
    const appleDefinition = await fetch(`${baseUrl}/dictionary/apple/definition`);
    expect(await appleDefinition.json()).toEqual({ definition: 'The round fruit of a tree of the rose family.' });
    const addedDictionaryWord = await fetch(`${baseUrl}/${list.id}/dictionary`, { method: 'POST', headers, body: JSON.stringify({ term: 'apple' }) });
    expect(addedDictionaryWord.status).toBe(201);
    const word = await addedDictionaryWord.json() as { id: string; term: string };
    expect(word).toMatchObject({ term: 'apple', status: 'UNFAMILIAR' });
    expect(word).not.toHaveProperty('example');
    const duplicateWord = await fetch(`${baseUrl}/${list.id}/dictionary`, { method: 'POST', headers, body: JSON.stringify({ term: 'apple' }) });
    expect(await duplicateWord.json()).toMatchObject({ id: word.id, status: 'UNFAMILIAR' });

    const semicolonDefinition = await fetch(`${baseUrl}/${list.id}/words`, {
      method: 'POST', headers, body: JSON.stringify({ term: 'pear', definition: 'first sense; second sense; third sense' }),
    });
    const pear = await semicolonDefinition.json() as { id: string; definition: string };
    expect(pear.definition).toBe('first sense; second sense;');
    await fetch(`${baseUrl}/${list.id}/words/${pear.id}`, { method: 'DELETE', headers });

    const addedLongDictionaryWord = await fetch(`${baseUrl}/${list.id}/dictionary`, {
      method: 'POST', headers, body: JSON.stringify({ term: 'longword' }),
    });
    expect(addedLongDictionaryWord.status).toBe(201);
    expect((await addedLongDictionaryWord.json() as { definition: string }).definition).toBe(`${'A'.repeat(499)}…`);

    const update = await fetch(`${baseUrl}/${list.id}/words/${word.id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ definition: 'A crisp fruit' }),
    });
    expect(await update.json()).toMatchObject({ definition: 'A crisp fruit' });
    const conflictingDictionaryWord = await fetch(`${baseUrl}/${list.id}/dictionary`, {
      method: 'POST', headers, body: JSON.stringify({ term: 'apple' }),
    });
    expect(await conflictingDictionaryWord.json()).toMatchObject({ id: word.id, definition: 'A crisp fruit' });
    const known = await fetch(`${baseUrl}/${list.id}/words/${word.id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'KNOWN' }) });
    expect(await known.json()).toMatchObject({ status: 'KNOWN' });

    const listForOtherUser = await fetch(`${baseUrl}/${list.id}`, { headers: { cookie: `lexiplay_session=${otherToken}` } });
    expect(listForOtherUser.status).toBe(404);
    const listForOwner = await fetch(baseUrl, { headers });
    expect(await listForOwner.json()).toMatchObject([{ id: list.id, name: 'My words', words: [
      { term: 'apple', definition: 'A crisp fruit', status: 'KNOWN' },
      { term: 'longword', definition: `${'A'.repeat(499)}…`, status: 'UNFAMILIAR' },
    ] }]);

    expect((await fetch(`${baseUrl}/${list.id}/words/${word.id}`, { method: 'DELETE', headers })).status).toBe(204);
  });

  it('previews TXT words before adding them to an owned list and rejects access by another user', async () => {
    const repository = new MemoryWordListRepository();
    const ownerToken = 'A'.repeat(43);
    const otherToken = 'B'.repeat(43);
    @Module({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }])],
      controllers: [WordListsController],
      providers: [
        WordListsService,
        WordListImportService,
        { provide: WordListRepository, useValue: repository },
        { provide: AccountService, useValue: { current: async (token: string) => ({ id: token === ownerToken ? 'user-1' : 'user-2', email: 'learner@example.test' }) } },
      ],
    })
    class WordListsImportHttpTestModule {}

    app = await NestFactory.create(WordListsImportHttpTestModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new (await import('@nestjs/common')).ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const baseUrl = `${await app.getUrl()}/api/v1/word-lists`;
    const headers = { cookie: `lexiplay_session=${ownerToken}` };
    const list = (await (await fetch(baseUrl, { headers })).json() as { id: string }[])[0]!;

    const file = new FormData();
    file.append('file', new Blob(['apple — A fruit\nchair: A seat'], { type: 'text/plain' }), 'words.txt');
    const preview = await fetch(`${baseUrl}/${list.id}/import-preview`, { method: 'POST', headers, body: file });
    expect(preview.status).toBe(200);
    const previewBody = await preview.json() as { rows: { term: string; definition: string }[]; totals: { ready: number } };
    expect(previewBody.rows).toEqual([
      expect.objectContaining({ term: 'apple', definition: 'A fruit' }),
      expect.objectContaining({ term: 'chair', definition: 'A seat' }),
    ]);
    expect(previewBody.totals.ready).toBe(2);
    for (const row of previewBody.rows) expect(row).not.toHaveProperty('example');

    const foreignPreview = new FormData();
    foreignPreview.append('file', new Blob(['apple'], { type: 'text/plain' }), 'words.txt');
    expect((await fetch(`${baseUrl}/${list.id}/import-preview`, { method: 'POST', headers: { cookie: `lexiplay_session=${otherToken}` }, body: foreignPreview })).status).toBe(404);

    const confirmed = await fetch(`${baseUrl}/${list.id}/import`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ rows: previewBody.rows.map(row => ({ ...row, selected: true })) }),
    });
    expect(confirmed.status).toBe(201);
    expect(await confirmed.json()).toMatchObject({ added: 2, duplicates: 0 });
    const refreshed = await fetch(`${baseUrl}/${list.id}`, { headers });
    expect(await refreshed.json()).toMatchObject({ words: [{ term: 'apple' }, { term: 'chair' }] });

    const csv = new FormData();
    csv.append('file', new Blob(['word,definition,part of speech,example\ngrape,A fruit,noun,A grape grows on a vine.'], { type: 'text/csv' }), 'words.csv');
    const csvPreview = await fetch(`${baseUrl}/${list.id}/import-preview`, { method: 'POST', headers, body: csv });
    const csvBody = await csvPreview.json() as { rows: Record<string, unknown>[] };
    expect(csvBody).toMatchObject({ rows: [expect.objectContaining({ term: 'grape', definition: 'A fruit', partOfSpeech: 'noun' })] });
    expect(csvBody.rows[0]).not.toHaveProperty('example');

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['word', 'definition', 'part of speech', 'example'], ['berry', 'A small fruit', 'noun', 'A berry grows on a bush.']]), 'Words');
    const spreadsheet = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const xlsx = new FormData();
    xlsx.append('file', new Blob([new Uint8Array(spreadsheet)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'words.xlsx');
    const xlsxPreview = await fetch(`${baseUrl}/${list.id}/import-preview`, { method: 'POST', headers, body: xlsx });
    const xlsxBody = await xlsxPreview.json() as { rows: Record<string, unknown>[] };
    expect(xlsxBody).toMatchObject({ rows: [expect.objectContaining({ term: 'berry', definition: 'A small fruit', partOfSpeech: 'noun' })] });
    expect(xlsxBody.rows[0]).not.toHaveProperty('example');

    const docx = new FormData();
    docx.append('file', new Blob([new Uint8Array(readFileSync(join(process.cwd(), 'src', 'modules', 'word-lists', 'fixtures', 'minimal.docx')))], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'words.docx');
    const docxPreview = await fetch(`${baseUrl}/${list.id}/import-preview`, { method: 'POST', headers, body: docx });
    expect(await docxPreview.json()).toMatchObject({ rows: [expect.objectContaining({ term: 'plum', definition: 'A stone fruit' })] });

    const pdf = new FormData();
    pdf.append('file', new Blob([new Uint8Array(pdfWithText('apple: A fruit from a PDF'))], { type: 'application/pdf' }), 'words.pdf');
    const pdfPreview = await fetch(`${baseUrl}/${list.id}/import-preview`, { method: 'POST', headers, body: pdf });
    expect(pdfPreview.status).toBe(200);
    expect(await pdfPreview.json()).toMatchObject({ rows: [expect.objectContaining({ term: 'apple', definition: 'A fruit from a PDF' })] });
  });
});
