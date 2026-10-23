import { expect, it } from 'vitest';
import { definitionInflections, websterInflections } from './dictionary-inflections';

it('extracts existing irregular forms without copying trailing explanatory text or mixing word classes', () => {
  expect(definitionInflections('born', 'verb', 'Past participle of bear. Given birth to.'))
    .toMatchObject([{ base: 'bear', form: 'born', kind: 'past_participle' }]);
  expect(definitionInflections('went', 'verb', 'Past tense of go.')).toMatchObject([{ base: 'go', kind: 'past' }]);
  expect(definitionInflections('worked', 'verb', 'Past tense and participle of work.').map(row => row.kind)).toEqual(['past', 'past_participle']);
  expect(definitionInflections('news', 'noun', 'News is information.')).toEqual([]);
  expect(definitionInflections('fails', 'verb', 'Plural of fail.')).toEqual([]);
});

it('uses complete explicit forms and only regular inflections from stems', () => {
  const links = websterInflections([{ meta: { id: 'study:1', stems: ['study', 'studies', 'studied', 'studying', 'studious', 'study group'] },
    hwi: { hw: 'study' }, fl: 'verb', ins: [{ if: 'stud*ied' }, { if: 'stud*ying' }, { ifc: '-ies' }] }]);
  expect(links.map(link => link.form)).toEqual(['studied', 'studied', 'studying', 'studies']);
  expect(links.every(link => link.base === 'study' && link.partOfSpeech === 'verb')).toBe(true);
});

it('retains multiple bases and irregular noun forms, but never imports spelling suggestions as words', () => {
  expect(websterInflections(['running', 'runny'])).toEqual([]);
  const links = websterInflections(['ignore', ...['axe', 'axis'].map(base => ({ meta: { id: base }, hwi: { hw: base }, fl: 'noun', ins: [{ if: 'ax*es', il: 'plural' }] }))]);
  expect(links.map(link => [link.base, link.form, link.kind])).toEqual([['axe', 'axes', 'plural'], ['axis', 'axes', 'plural']]);
  expect(websterInflections([{ meta: { id: 'run' }, hwi: { hw: 'run' }, fl: 'verb', ins: [{ if: 'ran' }], metaIgnored: true }]))
    .toMatchObject([{ form: 'ran', kind: 'verb_form' }]);
});

it('filters related headwords and does not mistake regular-looking run-on stems for irregular past forms', () => {
  const response = [
    { meta: { id: 'mean:1', stems: ['mean', 'meaned', 'meaner', 'means', 'meaning'] }, hwi: { hw: 'mean' }, fl: 'verb', ins: [{ if: 'meant' }, { if: 'mean*ing' }] },
    { meta: { id: 'mean distance', stems: ['mean distances'] }, hwi: { hw: 'mean distance' }, fl: 'noun' },
  ];
  expect(websterInflections(response, 'mean').map(row => row.form)).toEqual(['meant', 'meaning', 'means']);
});

it('does not admit mechanical search plurals, conflicting present forms, or capitalized homographs', () => {
  expect(websterInflections([{ meta: { id: 'equipment', stems: ['equipment', 'equipments'] }, hwi: { hw: 'equip*ment' }, fl: 'noun' }], 'equipment')).toEqual([]);
  expect(websterInflections([{ meta: { id: 'aircraft', stems: ['aircraft', 'aircrafts'] }, hwi: { hw: 'air*craft' }, fl: 'noun', ins: [{ if: 'aircraft', il: 'plural' }] }], 'aircraft')).toEqual([]);
  expect(websterInflections([{ meta: { id: 'be', stems: ['be', 'bes', 'is'] }, hwi: { hw: 'be' }, fl: 'verb', ins: [{ if: 'is', il: 'present tense third-person singular' }] }], 'be'))
    .toMatchObject([{ form: 'is', kind: 'third_person_singular' }]);
  expect(websterInflections([{ meta: { id: 'BASIC', stems: ['BASIC', 'BASICs'] }, hwi: { hw: 'BA*SIC' }, fl: 'noun' }], 'basic')).toEqual([]);
  expect(websterInflections([{ meta: { id: 'ought:2', stems: ['oughting', 'oughts'] }, hwi: { hw: 'ought' }, fl: 'verb' }], 'ought')).toEqual([]);
});

it('retains the defining sense of a specific homograph for new form definitions', () => {
  const links = websterInflections([{ meta: { id: 'ban:3' }, hwi: { hw: 'ban' }, fl: 'noun',
    ins: [{ if: 'bani', il: 'plural' }], shortdef: ['a monetary unit'] }], 'ban');
  expect(links).toMatchObject([{ form: 'bani', sourceRef: 'ban:3', senseDefinitions: ['a monetary unit'] }]);
});
