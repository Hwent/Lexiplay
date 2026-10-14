# Open English WordNet supplement

The importer supplements `dictionary_words` with the stable **2025 Core** release, rather than following editable `main` or importing the larger proper-name datasets. The authoritative source is the [official JSON archive](https://en-word.net/static/english-wordnet-2025-json.zip). Attribution credits the Open English WordNet team and Princeton WordNet; full notices are retained in `apps/web/public/licenses/` and exposed on the Licenses page.

## Run from the repository root

Download the ZIP into `.local-backups/wordnet-2025/english-wordnet-2025-json.zip` and extract it into `.local-backups/wordnet-2025/json`. Downloads, backups, and reports remain private and outside Git. No new parser dependency is required.

```powershell
pnpm dictionary:wordnet
pnpm dictionary:wordnet --apply --report .local-backups/wordnet-2025/applied.json
```

The command loads the root `.env`, rejects non-local database hosts, verifies complete lexical and synset references, and defaults to a rolled-back transaction. `--directory` and `--archive` can select explicit local artifacts. The report records both archive and content SHA-256 hashes. Re-running the same source is idempotent for active dictionary rows.

## Merge policy

- Lexical JSON exports map lemma → POS (including numbered homographs) → senses. Join sense synset IDs against the noun, verb, adjective, and adverb files, including `noun.Tops.json`.
- Map `n`/`v`/`r` to noun/verb/adverb; `a` and `s` both become adjective. Preserve spelling case, normalize NFC and whitespace, and skip words longer than the application's 100-character limit.
- Preserve existing useful definitions and existing populated POS groups. WordNet supplies new words and missing or empty POS groups. These are separate sources; existing Wiktionary prose is not re-licensed as WordNet.
- Preserve all imported definitions, synset IDs, and sense IDs in `dictionary_source_words`. Active dictionary rows select the first two source-ordered WordNet meanings per missing POS group; this ordering is not a claim about frequency.
- `dictionary_sources` records the release, license, artifact URL, hashes, and import time. Original full lexical-network files remain in the extracted archive; graph relations and inflected forms are not expanded into new dictionary rows.

## Safety and recovery

Application writes to accounts, personal lists, progress, games, and collection membership are untouched. A short dictionary write lock protects the import snapshot; ordinary readers can continue using the previous committed version until the transaction commits. Inserts are batched, and failures roll back the active dictionary and source tables together.

Before `--apply`, the importer writes `.local-backups/dictionary-before-wordnet-<timestamp>.json.gz` containing the previous dictionary rows. Retain that file and the import report. To undo an import, rehearse restoring those rows in a disposable local database first, then restore the dictionary under a maintenance transaction; do not restore or delete account data. The legacy `dictionary:seed` command replaces the active Wiktionary table, so repeat the WordNet supplement after any intentional full Wiktionary refresh.

WordNet mainly covers nouns, verbs, adjectives, and adverbs. It cannot fill every pronoun, conjunction, determiner, or inflected-form gap. Remaining CEFR definitions are reported explicitly. The browser dictionary cache version is advanced for this new source, while shared library caches are cleared on reload.
