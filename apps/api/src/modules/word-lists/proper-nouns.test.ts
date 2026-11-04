import { gameWord } from './game-entry';
import { expect, it } from 'vitest';
import properNouns from './proper-nouns.json';
import { defaultAnswerWords } from './default-answers';

it('retains place senses of mixed names and excludes personal identities and name senses', () => {
  const entries = new Map(properNouns.entries.map(entry => [entry.term, entry]));
  for (const term of ['John','Aaron','Bob','Mary','Putin','Trump','MacKenzie']) expect(entries.has(term)).toBe(false);
  expect(entries.get('Paris')!.definitions).toContain('The capital of France.');
  expect(entries.get('China')!.definitions.join(' ')).toContain('country in Asia');
  for (const entry of entries.values()) {
    expect(entry.revisionId).toMatch(/^\d+$/);
    expect(entry.definitions.length).toBeGreaterThan(0);
    expect(entry.definitions.join(' ')).not.toMatch(/\b(?:given name|surname|family name|last name|first name)\b/i);
    expect(entry.definitions.join(' ')).not.toMatch(/\{\{|\[\[/);
  }
  expect(entries.size).toBe(properNouns.entries.length);
});

it('admits reviewed proper nouns to default answers only when present in the playable dictionary', () => {
  expect(defaultAnswerWords(6, ['africa','london','john','new york'])).toEqual(['africa','london']);
  expect(defaultAnswerWords(5, ['paris','china','tokyo'])).toEqual(['paris','china','tokyo']);
  expect(defaultAnswerWords(6, ['london'])).not.toContain('africa');
});

it('requires explicit review for proper-noun game eligibility', () => {
  expect(gameWord({ term: 'Africa', partOfSpeech: 'proper noun', sourceMetadata: { gameEligible: true } })).toBe('africa');
  expect(gameWord({ term: 'John', partOfSpeech: 'proper noun', sourceMetadata: {} })).toBeUndefined();
  expect(gameWord({ term: 'New York', partOfSpeech: 'proper noun', sourceMetadata: { gameEligible: true } })).toBeUndefined();
});
