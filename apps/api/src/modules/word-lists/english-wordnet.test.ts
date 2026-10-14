import { expect, it } from 'vitest';
import { DictionaryRecord, supplementDictionary, wordnetRecords } from './english-wordnet';
const synsets = { '1-n': { partOfSpeech: 'n', definition: ['a shore beside a river'] }, '2-n': { partOfSpeech: 'n', definition: ['a financial institution'] }, '3-s': { partOfSpeech: 's', definition: [' full of light '] } };
it('joins lemma senses to synset definitions, preserves case and merges adjective satellites', () => {
  const records = wordnetRecords({ bank: { n: { sense: [{ id: 'bank-1', synset: '1-n' }, { id: 'bank-2', synset: '2-n' }] } }, Bright: { a: { sense: [{ id: 'bright-1', synset: '3-s' }] } } }, synsets);
  expect(records[0]!.senses[0]).toMatchObject({ partOfSpeech: 'noun', definitions: ['a shore beside a river', 'a financial institution'], synsetIds: ['1-n', '2-n'] });
  expect(records[1]).toMatchObject({ term: 'Bright', partOfSpeech: ['adjective'] });
});
it('fails on missing synset references rather than importing incomplete definitions', () => {
  expect(() => wordnetRecords({ bank: { n: { sense: [{ id: 'bank-1', synset: 'missing' }] } } }, synsets)).toThrow('Missing or incompatible');
});
it('combines numbered homographs while retaining their distinct meanings', () => {
  const records = wordnetRecords({ agora: { 'n-1': { sense: [{ id: 'agora-1', synset: '1-n' }] }, 'n-2': { sense: [{ id: 'agora-2', synset: '2-n' }] } } }, synsets);
  expect(records).toHaveLength(1); expect(records[0]!.senses[0]!.definitions).toEqual(['a shore beside a river', 'a financial institution']);
});
it('keeps an existing useful definition and only adds its missing word-class definition', () => {
  const existing: DictionaryRecord = { term: 'cover', definition: 'To put something over.', partOfSpeech: ['verb'], senses: [{ partOfSpeech: 'verb', definitions: ['To put something over.'] }] };
  const incoming: DictionaryRecord = { term: 'cover', definition: 'conceal', partOfSpeech: ['verb', 'noun'], senses: [{ partOfSpeech: 'verb', definitions: ['conceal'] }, { partOfSpeech: 'noun', definitions: ['a lid'], source: 'oewn-2025' }] };
  const result = supplementDictionary(existing, incoming);
  expect(result.record.definition).toBe(existing.definition); expect(result.record.senses[0]).toEqual(existing.senses[0]);
  expect(result.record.senses[1]).toMatchObject({ partOfSpeech: 'noun', definitions: ['a lid'] }); expect(existing.senses).toHaveLength(1);
  expect(supplementDictionary(result.record, incoming).changed).toBe(false);
});
it('fills empty definitions without discarding existing word classes, and selects at most two meanings for display', () => {
  const incoming: DictionaryRecord = { term: 'bank', definition: '', partOfSpeech: ['noun'], senses: [{ partOfSpeech: 'noun', definitions: ['one', 'two', 'three'] }] };
  const result = supplementDictionary({ term: 'bank', definition: '', partOfSpeech: ['noun', 'verb'], senses: [{ partOfSpeech: 'noun', definitions: [] }] }, incoming);
  expect(result.record).toMatchObject({ definition: 'one; two', partOfSpeech: ['noun', 'verb'] }); expect(result.record.senses[0]!.definitions).toEqual(['one', 'two']);
  expect(incoming.senses[0]!.definitions).toHaveLength(3);
});
