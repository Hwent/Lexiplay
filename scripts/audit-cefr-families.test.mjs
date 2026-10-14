import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFamilyFile, auditPools } from './audit-cefr-families.mjs';

test('respects explicit derivation groups and rejects orphan members', () => {
  const families = parseFamilyFile('\uFEFFDIFFER 0\r\n\tDIFFERENT 0\r\n\tDIFFERENCE 0\r\nDIFFERENTIAL 0\r\n', 1);
  assert.deepEqual(families[0].members, ['differ', 'different', 'difference']);
  assert.equal(families.length, 2);
  assert.throws(() => parseFamilyFile('\tDIFFERENT 0', 1), /no headword/);
  assert.throws(() => parseFamilyFile('bad format', 1), /Invalid/);
});

test('preserves member CEFR/POS, avoids guessing ambiguous words and separates phrases', () => {
  const families = parseFamilyFile('DIFFER 0\n\tDIFFERENT 0\nBANK 0\n', 1);
  families.push(...parseFamilyFile('BANK 0\n', 2));
  const report = auditPools([
    { id: 'a1', level: 'A1', words: [{ term: 'different', partsOfSpeech: ['adjective'] }] },
    { id: 'b2', level: 'B2', words: [
      { term: 'differ', partsOfSpeech: ['verb'] }, { term: 'bank', partsOfSpeech: ['noun','verb'] },
      { term: 'unknown', partsOfSpeech: ['noun'] }, { term: 'ice cream', partsOfSpeech: ['noun'] },
    ] },
  ], families);
  assert.equal(report.distinctMappedFamilies, 1);
  assert.deepEqual(Object.keys(report.crossLevelFamilies[0].levels), ['A1','B2']);
  assert.deepEqual(report.collections[1].families[0].members, [{term:'differ',partsOfSpeech:['verb']}]);
  assert.equal(report.collections[1].ambiguousLemmaCount, 1);
  assert.equal(report.collections[1].unclassifiedLemmaCount, 1);
  assert.equal(report.collections[1].phraseCount, 1);
  assert.equal(report.collections[1].entryCount, 5);
  assert.equal(report.collections[1].complete, false);
});
