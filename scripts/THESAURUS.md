# Local synonyms and antonyms

`DICTIONARYAPI2` supplies the Merriam-Webster Collegiate Thesaurus. It has its own cached
responses and per-key request ledger, separate from the dictionary API.
Select an additional Collegiate Thesaurus key with provider-approved quota using
`--key-env DICTIONARYAPI4`. The default remains `DICTIONARYAPI2`; keys are not rotated automatically.

After applying Prisma migrations, build a report (common CEFR headwords first), then import it:

```sh
pnpm dictionary:thesaurus --limit 1000
pnpm dictionary:thesaurus --apply .local-backups/thesaurus/report.json
```

Use `--terms path/to/terms.txt` for a UTF-8 file containing one headword per line, or
`--database-env path/to/.env` to select another local database. Each run reuses cached JSON and
continues with uncached terms. The importer counts failed requests too, stops at 1,000 requests
per key per UTC day, and does not retry automatically. Other applications may consume provider quota.
Cache, request ledgers and reports live under `.local-backups/` and must stay private.

Two tables store the data:

- `thesaurus_senses`: source entry UUID, sense path, headword, part of speech, definition and usage metadata.
  The optional dictionary entry link is exact by spelling and part of speech. Removing a local entry
  clears this link while preserving the thesaurus data.
- `thesaurus_relations`: target spelling, relation category, source list, group/order and usage/variant metadata.
  Targets may be phrases or absent from the dictionary; importing them never creates dictionary entries.

`syn_list` and `phrase_list` become `synonym`; `ant_list` becomes `antonym`.
`sim_list`, `rel_list`, `near_list` and `opp_list` remain `similar`, `related`, `near_antonym`
and `opposite`, respectively. These broader relationships are not presented as exact synonyms or antonyms.
Entry-wide metadata lists are not flattened across senses. No reverse or transitive relationships are inferred.

Imports are additive and transactional. Duplicate senses/relations are ignored, existing dictionary
definitions and user data stay intact, and stale reports are rejected. Replacing a cached provider response
does not remove previously imported relationships.

Read the local data without API calls:

```http
GET /api/v1/word-lists/dictionary/happy/thesaurus
```

The response groups relationships under their source sense, with the definition, part of speech and labels.
The current website UI is unchanged. Future batches can use the same commands after the quota resets.

Source: [Merriam-Webster JSON documentation](https://dictionaryapi.com/products/json),
[Collegiate Thesaurus](https://dictionaryapi.com/products/api-collegiate-thesaurus).
