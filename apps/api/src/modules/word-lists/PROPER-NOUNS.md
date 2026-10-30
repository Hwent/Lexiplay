# Reviewed proper nouns

`proper-nouns.json` supplements Simple English Wiktionary proper-noun senses from the
2026-10-01 Wikimedia snapshot. Each entry retains its original spelling and revision ID.
Revision URLs use `https://simple.wiktionary.org/w/index.php?oldid=<revisionId>`.
See `SIMPLE-WIKTIONARY-LICENSE` for attribution and ShareAlike requirements.

Personal names, surnames, personal identities and their spelling variants are excluded.
Mixed entries retain non-personal senses: Paris keeps its city definition, for example.
Name templates are removed; capital-city and Wikipedia-link templates are expanded.
Obvious erroneous or incomplete source definitions are corrected in the reviewed data.

Apply the additive supplement with a configured PostgreSQL pool:

```ts
import { importProperNouns } from './proper-noun-import';
await importProperNouns(pool);
```

Imports are transactional and idempotent. Existing entries, definitions and user references
are preserved. A changed import updates the library version to invalidate word caches.
Importing data is a maintenance operation, not an automatic application startup step.

Reviewed single words of 3–9 ASCII letters have `source_metadata.gameEligible=true`.
Games normalize these spellings to lowercase; other proper nouns remain in the dictionary.
Default Word Guess answers and connected Word Ladder words include the reviewed words.
Original Wordle retains its fixed answer collection. Game definitions include reviewed
proper-noun senses alongside a lowercase homograph; normal dictionary lookup still prefers
the requested spelling.
