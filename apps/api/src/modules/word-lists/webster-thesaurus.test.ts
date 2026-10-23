import { expect, it } from 'vitest';
import { websterThesaurus } from './webster-thesaurus';

it('keeps exact relations, approximate relations, phrases and usage labels distinct within a sense', () => {
  const senses = websterThesaurus([{ meta: { id: 'happy', uuid: 'happy-adjective', syns: [['do-not-flatten']] },
    hwi: { hw: 'hap*py' }, fl: 'adjective', def: [{ sseq: [[['sense', {
      sn: '1', dt: [['text', 'feeling {it}pleasure{/it}'], ['vis', [{ t: 'a happy person' }]]],
      syn_list: [[{ wd: 'cheerful', wsls: { wsl: 'informal' } }, { wd: 'cheerful' }, { wd: 'happy' }]],
      phrase_list: [[{ wd: 'on cloud nine', wvrs: [{ wva: 'on top of the world' }] }]],
      ant_list: [[{ wd: 'unhappy' }]], near_list: [[{ wd: 'gloomy' }]],
      sim_list: [[{ wd: 'content' }]], rel_list: [[{ wd: 'fortunate' }]], opp_list: [[{ wd: 'miserable' }]],
    }]]] }] }], 'happy');
  expect(senses).toHaveLength(1);
  expect(senses[0]).toMatchObject({ sourceEntryId: 'happy-adjective', definition: 'feeling pleasure', metadata: { sn: '1' } });
  const relations = senses[0]!.relations;
  expect(relations.map(row => row.kind)).toEqual(['synonym', 'synonym', 'antonym', 'similar', 'related', 'near_antonym', 'opposite']);
  expect(relations[0]).toMatchObject({ term: 'cheerful', metadata: { wsls: { wsl: 'informal' } } });
  expect(relations[1]).toMatchObject({ term: 'on cloud nine', sourceList: 'phrase_list' });
  expect(relations.some(row => row.term === 'do-not-flatten')).toBe(false);
});

it('preserves different senses, nested sense groups and UUIDs for identical headword IDs', () => {
  const response = ['adjective', 'noun'].map(pos => ({ meta: { id: 'good', uuid: `good-${pos}` }, hwi: { hw: 'good' }, fl: pos,
    def: [{ sseq: [[['pseq', [[['sense', { dt: [['text', pos]], syn_list: [[{ wd: pos === 'noun' ? 'benefit' : 'pleasant' }]],
      sdsense: { dt: [['text', 'a divided sense']], ant_list: [[{ wd: 'bad' }]] } }]]]]]] }] }));
  const senses = websterThesaurus(response, 'good');
  expect(senses).toHaveLength(4);
  expect(new Set(senses.map(sense => sense.sourceEntryId)).size).toBe(2);
  expect(new Set(senses.map(sense => `${sense.sourceEntryId}:${sense.senseKey}`)).size).toBe(4);
});

it('ignores suggestions, unrelated headwords and differently capitalized homographs', () => {
  expect(websterThesaurus(['good', 'goods'], 'godd')).toEqual([]);
  const response = ['Good', 'good enough'].map(term => ({ meta: { id: term, uuid: term }, hwi: { hw: term }, fl: 'adjective',
    def: [{ sseq: [[['sense', { syn_list: [[{ wd: 'fine' }]] }]]] }] }));
  expect(websterThesaurus(response, 'good')).toEqual([]);
  expect(() => websterThesaurus({ error: 'invalid key' }, 'good')).toThrow('JSON array');
});
