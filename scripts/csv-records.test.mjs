import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvRecords } from './csv-records.mjs';
test('preserves quoted commas, escaped quotes, multiline notes and empty trailing fields',()=>{
  assert.deepEqual(csvRecords('word,pos,level,note\r\nseedy,adjective,C2,"run down, untrustworthy"\r\nexample,noun,C2,"a ""quoted""\nmeaning"\r\nword,verb,C2,\r\n'),[
    ['word','pos','level','note'],['seedy','adjective','C2','run down, untrustworthy'],['example','noun','C2','a "quoted"\nmeaning'],['word','verb','C2',''],
  ]);
  assert.throws(()=>csvRecords('"unfinished'),/Unclosed/);
});
