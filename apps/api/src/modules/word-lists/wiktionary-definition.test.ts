import { describe, expect, it } from 'vitest';
import { parseWiktionaryDefinition } from './wiktionary-definition';

describe('Simple English Wiktionary definitions', () => {
  it('imports because from its definition section even though its page introduction is empty', () => {
    expect(parseWiktionaryDefinition(`{{BE850}}
=== Pronunciation ===
* {{IPA|/bɪˈkəz/}}
== Preposition ==
{{preposition}}
# You use '''because''' to show the [[reason]] for something.
#: ''I bought the book '''because''' I wanted to read it.''
=== Synonyms ===
* [[since]]`)).toEqual({ definition: 'You use because to show the reason for something.', partOfSpeech: ['preposition'] });
  });

  it('cleans labels and links and keeps two senses without examples', () => {
    expect(parseWiktionaryDefinition(`== Noun ==
# {{countable}} An '''apple''' is a [[sweet]] [[fruit]].
#: ''I ate an apple.''
# {{uncountable}} Big Apple is a name for [[w:New York|New York City]].
# A third sense.`).definition).toBe('An apple is a sweet fruit.; Big Apple is a name for New York City.');
  });

  it('preserves definitions supplied by common inflection templates', () => {
    expect(parseWiktionaryDefinition('== Verb ==\n# {{past of|walk}}')).toEqual({ definition: 'Past of walk.', partOfSpeech: ['verb'] });
  });
});
