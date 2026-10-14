import { describe, expect, it } from 'vitest';
import { parseWiktionaryDefinition } from './wiktionary-definition';

describe('Simple English Wiktionary definitions', () => {
  it('imports tear from numbered noun and verb sections', () => {
    // Reduced from https://simple.wiktionary.org/w/index.php?title=tear&oldid=554667
    // Dictionary text attribution and terms: SIMPLE-WIKTIONARY-LICENSE.
    expect(parseWiktionaryDefinition(`==Noun 1==
# A '''tear''' is [[hole]] made by [[pull]]ing or [[rip]]ping something.
==Noun 2==
# A '''tear''' is a drop of [[water]] that comes from your [[eye]] when you [[cry]].
==Verb 1==
# To rip something apart.
==Verb 2==
# To produce tears.`)).toMatchObject({
      definition: 'noun: A tear is hole made by pulling or ripping something.; A tear is a drop of water that comes from your eye when you cry.\nverb: To rip something apart.; To produce tears.',
      partOfSpeech: ['noun', 'verb'],
    });
  });

  it('imports because from its definition section even though its page introduction is empty', () => {
    expect(parseWiktionaryDefinition(`{{BE850}}
=== Pronunciation ===
* {{IPA|/bɪˈkəz/}}
== Preposition ==
{{preposition}}
# You use '''because''' to show the [[reason]] for something.
#: ''I bought the book '''because''' I wanted to read it.''
=== Synonyms ===
* [[since]]`)).toMatchObject({ definition: 'You use because to show the reason for something.', partOfSpeech: ['preposition'] });
  });

  it('cleans labels and links and keeps all senses without examples', () => {
    expect(parseWiktionaryDefinition(`== Noun ==
# {{countable}} An '''apple''' is a [[sweet]] [[fruit]].
#: ''I ate an apple.''
# {{uncountable}} Big Apple is a name for [[w:New York|New York City]].
# A third sense.`).definition).toBe('An apple is a sweet fruit.; Big Apple is a name for New York City.; A third sense.');
  });

  it('preserves definitions supplied by common inflection templates', () => {
    expect(parseWiktionaryDefinition('== Verb ==\n# {{past of|walk}}')).toMatchObject({ definition: 'Past of walk.', partOfSpeech: ['verb'] });
  });

  it('reads nested parts of speech and present-tense forms', () => {
    expect(parseWiktionaryDefinition('== English ==\n=== Verb ===\n# {{third-person singular of|en|walk}}')).toMatchObject({
      definition: 'Third person singular of walk.', partOfSpeech: ['verb'],
    });
  });

  it('keeps definitions longer than the old 2,000-character limit', () => {
    const definition = 'A definition. '.repeat(200).trim();
    expect(parseWiktionaryDefinition('== Noun ==\n# ' + definition).definition).toBe(definition);
  });

  it('normalizes numbered parts of speech and ignores unrelated numbered sections', () => {
    expect(parseWiktionaryDefinition(`== Proper noun 12 ==
# A place name.
== References 2 ==
# This is a reference, not a definition.
== Adjective 3 ==
# Describes a quality.`)).toMatchObject({
      definition: 'Describes a quality.',
      partOfSpeech: ['adjective'],
    });
  });
});
