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
    { meta: { id: 'mean:1', stems: ['mean', 'meaned', 'meaner', 'means', 'meaning'] }, hwi: { hw: 'mean' }, fl: 'verb', ins: [{ if: 'meant' }] },
    { meta: { id: 'mean distance', stems: ['mean distances'] }, hwi: { hw: 'mean distance' }, fl: 'noun' },
  ];
  expect(websterInflections(response, 'mean').map(row => row.form)).toEqual(['meant', 'means', 'meaning']);
});
