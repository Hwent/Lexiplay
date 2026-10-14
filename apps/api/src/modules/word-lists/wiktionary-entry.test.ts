import { describe, expect, it } from 'vitest';
import { wiktionaryEntry, WiktionaryEntryCollector } from './wiktionary-entry';
describe('source dictionary entries', () => {
  it('keeps case-distinct titles, punctuation, Unicode and word forms', () => {
    for (const term of ['Polish', 'polish', 'café', '3D', 'U.S.', 'walked', 'a'.repeat(101)]) {
      expect(wiktionaryEntry(term, '== Noun ==\n# A source definition.')?.term).toBe(term);
    }
  });
  it('retains entries whose definitions need parser support', () => {
    expect(wiktionaryEntry('walked', '{{unsupported template}}')).toEqual({ term: 'walked', definition: '', partOfSpeech: [], senses: [] });
    expect(wiktionaryEntry('Main Page', 'Welcome')).toBeNull();
  });
});

describe('revision continuation', () => {
  it('waits for later revision batches without losing or duplicating titles', () => {
    const collector = new WiktionaryEntryCollector();
    const page = (title: string) => ({ title, revisions: [{ slots: { main: { content: '== Noun ==\n# A definition.' } } }] });
    expect(collector.collect([page('apple'), { title: 'walked' }]).map(entry => entry.term)).toEqual(['apple']);
    expect(() => collector.assertComplete()).toThrow('walked');
    expect(collector.collect([{ title: 'apple' }, page('walked')]).map(entry => entry.term)).toEqual(['walked']);
    expect(collector.collect([page('apple'), page('walked')])).toEqual([]);
    expect(() => collector.assertComplete()).not.toThrow();
  });
});
