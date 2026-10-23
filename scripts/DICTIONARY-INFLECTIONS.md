# Supplement dictionary inflections

Existing spellings, definitions, saved words, and collection membership are preserved.
`dictionary_inflections` links each inflected entry to a base entry of the same part of speech.
Missing forms receive independent entries with a form label and the base's first two English definitions,
so existing dictionary search and guess validation work without external API calls.
For API forms, use the returned homograph's short definitions, rather than unrelated local meanings
of the same spelling (for example, the currency plural `bani` must not inherit the prohibition sense of `ban`).
This does not merge learning progress or add forms to curated answer collections.

Prioritize headwords whose inflected **spelling is absent from the whole local dictionary**,
before headwords that only lack a part of speech or relationship. Count new spellings separately
from new spelling/POS entries. Predictable suffix patterns may rank query candidates, but a prediction
is never evidence for import: confirm each form in the API's explicit inflection data.

Generate a report from existing explicit word-form definitions, then apply it:

```sh
pnpm dictionary:inflections
pnpm dictionary:inflections --apply .local-backups/inflections/report.json
```

Apply the Prisma migrations before importing. The command only accepts local PostgreSQL.
It refuses a stale report, inserts within one transaction, and leaves existing meanings intact.
Rerunning is safe. A full dictionary replacement can remove supplemented entries;
rerun this supplement after replacing the dictionary.

For Merriam-Webster, `DICTIONARYAPI1` is the **Collegiate Dictionary** key;
`DICTIONARYAPI2` is the **Collegiate Thesaurus** key and is not used here.
With appropriate permission for automated queries and local storage, use a UTF-8 file with one term per line:

```sh
pnpm dictionary:inflections --fetch --terms .local-backups/inflections/terms.txt --limit 8
```

The report combines existing dictionary links with API results. Inspect the report and cached
JSON under `.local-backups/merriam-webster-collegiate/` before applying.
Only explicit inflections and regular third-person verb stems supported by an explicit conjugation entry are accepted.
Noun plurals require `ins`: search stems can include mechanical forms such as `equipments` and `aircrafts`.
Spelling suggestions, differently capitalized headwords, unrelated stems, derivatives, idioms,
and incomplete inflection endings are excluded.
Unlabelled irregular verb forms retain the general `verb_form` type rather than guessing a tense.

Responses are cached and reused on subsequent runs. A shared lock and usage ledger count requests
before sending, including failures, and enforce at most 1,000 requests per key per UTC day in this importer.
Other applications using the key may consume additional provider quota. No automatic retries or key rotation.
If a process is forcibly terminated, remove `fetch.lock` only after confirming it has stopped.
Keep cache, reports, and keys private; they are gitignored.

References: [JSON format](https://dictionaryapi.com/products/json),
[usage terms](https://dictionaryapi.com/info/terms-of-service).
