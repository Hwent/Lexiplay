import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { WordListImportService } from './word-list-import';

describe('word-list import parsing', () => {
  it('parses compounds and reports duplicate, invalid, and previously saved terms', async () => {
    const importer = new WordListImportService();
    const preview = await importer.preview({ originalname: 'words.txt', buffer: Buffer.from(
      'APPLE — A fruit\nbrave - Showing courage\nwell-being: Good health\ncurious\napple\nbad123\nchair\n',
    ) }, ['chair']);
    expect(preview.rows.map(row => [row.term,row.selected])).toEqual([
      ['apple',true],['brave',true],['well-being',true],['curious',true],['apple',false],['bad123',false],['chair',false],
    ]);
    expect(preview.totals).toEqual({ ready: 4, warnings: 2, rejected: 1 });
    await expect(importer.preview({ originalname: 'words.txt', buffer: Buffer.from('apple\n'.repeat(1002)) }, [])).rejects.toThrow();
  });
  it('reads spreadsheet first-column words and rejects unsupported files', async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['word','definition'],['apple','A fruit.']]), 'Words');
    const importer = new WordListImportService();
    const preview = await importer.preview({ originalname: 'words.xlsx', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) }, []);
    expect(preview.rows).toContainEqual(expect.objectContaining({ term: 'apple' }));
    await expect(importer.preview({ originalname: 'words.exe', buffer: Buffer.from('apple') }, [])).rejects.toThrow();
  });
});
