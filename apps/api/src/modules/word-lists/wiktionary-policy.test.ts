import { describe, expect, it } from 'vitest';
import { wiktionaryEntry } from './wiktionary-entry';
import { parseWiktionaryDefinition } from './wiktionary-definition';
// Reduced source patterns from Simple English Wiktionary; see SIMPLE-WIKTIONARY-LICENSE.
describe('dictionary content policy', () => {
  it('filters proper names and abbreviations without dropping ordinary senses of mixed entries', () => {
    expect(wiktionaryEntry('John', '== Proper noun ==\n# {{male given name}}')).toBeNull();
    expect(wiktionaryEntry('USA', '== Initialism ==\n# A short way of saying United States.')).toBeNull();
    expect(wiktionaryEntry('Dr.', '== Noun ==\n# {{abbreviation of|doctor}}')).toBeNull();
    expect(wiktionaryEntry('May', '== Proper noun ==\n# A name.\n== Verb ==\n# Expresses permission.')?.partOfSpeech).toEqual(['verb']);
  });
  it('keeps suffix definitions and combined past-tense/participle forms', () => {
    expect(wiktionaryEntry('-ness', '== Suffix ==\n# Turns an adjective into a noun.')).toMatchObject({ definition: 'Turns an adjective into a noun.', partOfSpeech: ['suffix'] });
    expect(wiktionaryEntry('walked', '== Verb ==\n# {{past tense and participle of|walk}}')).toMatchObject({ definition: 'Past tense and participle of walk.', partOfSpeech: ['verb'] });
  });
  it('associates each sense with its part of speech and preserves repeated sections', () => {
    expect(parseWiktionaryDefinition('== Noun 1 ==\n# A hole.\n== Noun 2 ==\n# A drop from an eye.\n== Verb ==\n# To rip.')).toMatchObject({
      senses: [{ partOfSpeech: 'noun', definitions: ['A hole.', 'A drop from an eye.'] }, { partOfSpeech: 'verb', definitions: ['To rip.'] }],
    });
  });
});

describe('remaining empty-definition cleanup', () => {
  it.each([
    ['running', '{{gerund-participle of|run}}', 'Gerund participle of run.'],
    ['astonishing', '{{pp|astonish}}', 'Present participle of astonish.'],
    ['arranges', '{{third person|arrange}}', 'Third person singular of arrange.'],
    ['astonishes', '{{tps|astonish}}', 'Third person singular of astonish.'],
    ['ran', '{{simple past of|run}}', 'Simple past of run.'],
    ['kinking', '{{present participle|kink}}', 'Present participle of kink.'],
  ])('keeps %s with its verb-form definition', (term, template, definition) => {
    expect(wiktionaryEntry(term, '== Verb ==\n# ' + template)).toMatchObject({ definition, partOfSpeech: ['verb'] });
  });
  it('reads standalone plural-form definitions', () => {
    expect(wiktionaryEntry('expectations', '== Noun ==\n{{noun|expectation}}\n{{plural of|expectation}}')).toMatchObject({ definition: 'Plural of expectation.', partOfSpeech: ['noun'] });
  });
  it('excludes unresolved multiwords, spelling variants and contractions', () => {
    expect(wiktionaryEntry('herd immunity', '== Expression ==')).toBeNull();
    expect(wiktionaryEntry('enrol', '== Verb ==\n# {{UK}} {{other spelling of|enroll}}')).toBeNull();
    expect(wiktionaryEntry("didn't", '== Verb ==\n# {{negative of|did}}')).toBeNull();
  });
  it('retains already-defined phrases and contractions', () => {
    expect(wiktionaryEntry('ice cream', '== Noun ==\n# A frozen dessert.')?.definition).toBe('A frozen dessert.');
    expect(wiktionaryEntry("don't", '== Verb ==\n# Do not.')?.definition).toBe('Do not.');
  });
});
