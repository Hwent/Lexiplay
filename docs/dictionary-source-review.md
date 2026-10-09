# Dictionary source review

## Why “because” is missing

Before the source update, LexiPlay seeded its dictionary from Princeton WordNet 3.1. The old seed script imported only nouns, verbs, adjectives, and adverbs. WordNet is intentionally a lexical database of those open-class parts of speech; it does not include function words such as conjunctions and prepositions. Princeton’s FAQ explicitly lists “because” among the excluded words. This was a source coverage limitation, not a search failure.

WordNet remains useful for the game’s word pool and semantic relationships, but it is not a complete learner’s dictionary. Princeton says WordNet is no longer actively developed and has no new releases planned.

## Sources considered

| Source | Coverage and quality | Integration and license considerations | Fit |
| --- | --- | --- | --- |
| **Merriam-Webster Learner’s Dictionary API** | Curated for English learners, with definitions, examples, usage, pronunciation, and broad learner vocabulary. Its entry for “because” supplies the expected conjunction definition. | Requires an API key. Merriam-Webster currently advertises up to 1,000 requests per day for non-commercial use; commercial usage requires separate terms. Best suited to fetch a definition when a user selects a search result, rather than bulk-copying definitions into LexiPlay. | **Best quality for online, on-demand definitions**, subject to confirming the app’s usage terms and request budget. |
| **Wiktionary data via Kaikki/Wiktextract** | Includes function words such as “because” and has broad coverage. The extracted English dump is large (the raw-data page lists 2.8 GB compressed / 23.9 GB uncompressed). Community entries vary in consistency. | Wiktionary text is dual-licensed CC BY-SA 4.0 and GFDL. Attribution and share-alike obligations apply; content may also include separately copyrighted material. Requires filtering, attribution/provenance handling, and license review before redistribution. | **Best candidate for a local/offline dictionary** if the project accepts the data processing and license requirements. |
| **Cambridge Dictionary API** | Learner-focused reference content. | Access requires registration/contact and an API key; access terms need to be confirmed with Cambridge. | Worth evaluating if a licensed provider is preferred, but access is less immediately self-serve. |
| **Oxford Dictionaries API** | High-quality publisher content. | API access is licensed; Oxford’s terms restrict standalone dictionary products and caching/local storage without approval, and enterprise access may carry a substantial cost. | Less suitable for LexiPlay’s local word-list/offline use without a negotiated license. |

## Recommendation

**Decision:** use Simple English Wiktionary to populate LexiPlay’s own PostgreSQL dictionary. The stored dictionary is the single standard for search, game answers, and accepted guesses. It covers function words and provides learner-friendly definitions without requiring a commercial API key. The importer uses its public MediaWiki API and stages a complete import before replacing the database rows. Preserve attribution and share-alike terms when redistributing those definitions. The old static game files are retained as historical snapshots and are no longer used by gameplay.

The project does not add Merriam-Webster or another dictionary provider/API key.

## References

- Princeton WordNet FAQ, “Why are words like of, an, the, and, about, above, because … missing?”: https://wordnet.princeton.edu/frequently-asked-questions
- Princeton WordNet project status: https://wordnet.princeton.edu/
- Merriam-Webster Learner’s Dictionary API: https://dictionaryapi.com/products/api-learners-dictionary
- Merriam-Webster API terms and overview: https://dictionaryapi.com/
- Merriam-Webster “because” entry: https://www.merriam-webster.com/dictionary/because
- Kaikki/Wiktextract raw data and dump size: https://kaikki.org/dictionary/rawdata.html
- Wiktionary copyright and license information: https://en.wiktionary.org/wiki/Wiktionary:Copyrights
- Cambridge Dictionary API: https://dictionary-api.cambridge.org/api/about
- Oxford Dictionaries API FAQ: https://developer.oxforddictionaries.com/faq
- Oxford Dictionaries API terms: https://developer.oxforddictionaries.com/api-terms-and-conditions?tab=commercial
