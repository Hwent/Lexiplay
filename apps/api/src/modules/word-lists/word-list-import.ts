import { BadRequestException, Injectable } from '@nestjs/common';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { PDFParse } from 'pdf-parse';

export type ImportIssue = 'INVALID_TERM' | 'DUPLICATE_IN_FILE' | 'ALREADY_IN_LIST' | 'MISSING_TERM';
export type ImportPreviewRow = {
  rowNumber: number;
  term: string;
  definition: string;
  partOfSpeech: string | null;
  selected: boolean;
  issues: ImportIssue[];
};

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 1000;
const MAX_ZIP_UNCOMPRESSED_BYTES = 12 * 1024 * 1024;

@Injectable()
export class WordListImportService {
  async preview(file: { originalname: string; buffer: Buffer } | undefined, existingTerms: string[]): Promise<{ rows: ImportPreviewRow[]; totals: { ready: number; warnings: number; rejected: number } }> {
    if (!file?.buffer?.length) throw new BadRequestException({ code: 'IMPORT_FILE_REQUIRED', message: 'Choose a file to preview.' });
    if (file.buffer.length > MAX_BYTES) throw new BadRequestException({ code: 'IMPORT_FILE_TOO_LARGE', message: 'Choose a file smaller than 5 MB.' });
    const extension = file.originalname.toLowerCase().split('.').pop();
    if (!['txt', 'docx', 'csv', 'xlsx', 'pdf'].includes(extension ?? '')) {
      throw new BadRequestException({ code: 'IMPORT_FORMAT_UNSUPPORTED', message: 'Choose a TXT, DOCX, CSV, XLSX, or PDF file.' });
    }

    let sourceRows: string[][];
    try {
      if (extension === 'docx') {
        inspectZip(file.buffer);
        const text = (await mammoth.extractRawText({ buffer: file.buffer })).value;
        sourceRows = text.split(/\r?\n/).map(line => [line]);
      } else if (extension === 'pdf') {
        const parser = new PDFParse({ data: file.buffer });
        try {
          const result = await parser.getText({ first: 50 });
          sourceRows = result.text.replace(/--\s*\d+\s+of\s+\d+\s*--/gi, '').split(/\r?\n/).map(line => [line]);
        } finally {
          await parser.destroy();
        }
      } else if (extension === 'xlsx') {
        inspectZip(file.buffer);
        const workbook = XLSX.read(file.buffer, { type: 'buffer', cellFormula: false, cellHTML: false });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]!];
        if (firstSheet?.['!ref']) {
          const range = XLSX.utils.decode_range(firstSheet['!ref']);
          if (range.e.r >= MAX_ROWS + 1) throw new Error('Spreadsheet has too many rows');
          sourceRows = XLSX.utils.sheet_to_json<string[]>(firstSheet, {
            header: 1, raw: false, defval: '', range: { s: { r: 0, c: 0 }, e: { r: MAX_ROWS, c: 3 } },
          });
        } else sourceRows = [];
      } else if (extension === 'csv') {
        sourceRows = parseCsv(file.buffer.toString('utf8'));
      } else {
        sourceRows = file.buffer.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/).map(line => [line]);
      }
    } catch {
      throw new BadRequestException({ code: 'IMPORT_FILE_UNREADABLE', message: 'This file could not be read. Check the format and try again.' });
    }

    if (sourceRows.length > MAX_ROWS + 1) throw new BadRequestException({ code: 'IMPORT_TOO_MANY_ROWS', message: 'A file can contain up to 1,000 words.' });
    const rows = sourceRows.map((columns, index) => ({ columns: columns.map(value => String(value ?? '').trim()), rowNumber: index + 1 }));
    const headerAt = rows.length && (extension === 'csv' || extension === 'xlsx') && /^(word|term|text)$/i.test(rows[0]!.columns[0] ?? '') ? 0 : -1;
    const headers = headerAt === 0 ? rows[0]!.columns.map(value => value.toLowerCase()) : [];
    const content = headerAt === 0 ? rows.slice(1) : rows;
    const seen = new Set<string>();
    const existing = new Set(existingTerms.map(term => term.toLowerCase()));
    const previewRows: ImportPreviewRow[] = content.filter(({ columns }) => columns.some(Boolean)).map(({ columns, rowNumber }) => {
      const termColumn = headerAt === 0 ? Math.max(0, headers.findIndex(value => ['word', 'term', 'text'].includes(value))) : 0;
      let term = columns[termColumn] ?? '';
      let definition = columns[headerAt === 0 ? headers.findIndex(value => ['definition', 'meaning'].includes(value)) : 1] ?? '';
      let partOfSpeech = columns[headerAt === 0 ? headers.findIndex(value => ['part of speech', 'pos'].includes(value)) : 2] ?? '';
      if (columns.length === 1) {
        const match = /^([^—:\t,]+?)\s*(?:—|:|\t|,|\s+-\s+)\s*(.*)$/.exec(term);
        if (match) { term = match[1]!.trim(); definition = match[2]!.trim(); }
      }
      term = term.toLowerCase().trim();
      const issues: ImportIssue[] = [];
      if (!term) issues.push('MISSING_TERM');
      else if (!/^[a-z][a-z '-]{0,99}$/.test(term)) issues.push('INVALID_TERM');
      if (term && seen.has(term)) issues.push('DUPLICATE_IN_FILE');
      if (term && existing.has(term)) issues.push('ALREADY_IN_LIST');
      seen.add(term);
      return { rowNumber, term, definition: definition.slice(0, 500), partOfSpeech: partOfSpeech || null, selected: !issues.length, issues };
    });
    return {
      rows: previewRows,
      totals: {
        ready: previewRows.filter(row => !row.issues.length).length,
        warnings: previewRows.filter(row => row.issues.length && row.issues.some(issue => issue === 'DUPLICATE_IN_FILE' || issue === 'ALREADY_IN_LIST')).length,
        rejected: previewRows.filter(row => row.issues.some(issue => issue === 'INVALID_TERM' || issue === 'MISSING_TERM')).length,
      },
    };
  }
}

function inspectZip(buffer: Buffer) {
  if (buffer.length < 22 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new Error('Invalid document container');
  const start = Math.max(0, buffer.length - 65_557);
  let endRecord = -1;
  for (let offset = buffer.length - 22; offset >= start; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { endRecord = offset; break; }
  }
  if (endRecord < 0) throw new Error('Invalid document container');
  const entryCount = buffer.readUInt16LE(endRecord + 10);
  const centralSize = buffer.readUInt32LE(endRecord + 12);
  let offset = buffer.readUInt32LE(endRecord + 16);
  if (entryCount > 2000 || offset + centralSize > endRecord) throw new Error('Invalid document index');
  let expandedSize = 0;
  for (let index = 0; index < entryCount; index++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid document index');
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    if (uncompressedSize === 0xffffffff) throw new Error('Oversized document entry');
    expandedSize += uncompressedSize;
    if (expandedSize > MAX_ZIP_UNCOMPRESSED_BYTES) throw new Error('Document expands beyond the size limit');
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index++) {
    const character = source[index]!;
    if (character === '"' && quoted && source[index + 1] === '"') { cell += '"'; index++; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && source[index + 1] === '\n') index++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += character;
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
