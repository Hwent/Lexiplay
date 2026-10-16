# Database maintenance

Prisma migrations are the only schema-change mechanism. Application startup never creates or alters tables.
The schema is [schema.prisma](../apps/api/prisma/schema.prisma); SQL-only constraints and indexes live in its migrations.
There are 14 application tables, plus Prisma's migration bookkeeping table.

Add these settings to the private root `.env`:

| Tables | Responsibility |
| --- | --- |
| account_users | Account identity, password hash, optional email, integer coin balance (100 initially). |
| account_sessions, account_actions | Expiring login sessions and single-use verification/reset tokens. |
| guest_sessions | Hashed guest identity, separate integer coin balance (10 initially), expiry and transfer claim. |
| progress_transfers | Idempotent account-bound receipts for guest progress transfers. |
| library_state | One current cache version, changed during maintenance. No revision history. |
| word_families | Source-backed groups; families do not replace spelling/POS identities. |
| dictionary_entries | Case-sensitive spelling + part of speech, family and source metadata. |
| dictionary_definitions | Meanings keyed by entry, language code and order. The product uses English. |
| vocabulary_collections | Official collection metadata and category; source metadata is stored here. |
| collection_entries | Unique collection/entry memberships; entries may belong to several collections. |
| user_vocabulary_collections | Saved official collection links. |
| user_words | One personal vocabulary per account, entry membership, review progress and explicit exclusions. |
| practice_games | Owner, original payer, answer spelling, difficulty, outcome, attempt count and actual net coin change. Temporary JSON holds active guesses, hints and promised coin values; settlement clears it. |

Definitions always come from the current dictionary, including game history. Users cannot edit definitions.
Saving a collection imports its entries without duplicates. Maintenance automatically imports later members.
Unsave/source removal keeps personal words and progress; explicit word removal stays excluded until explicitly added again.

## Initial local cutover

The approved source is the connected local database with **156,600 dictionary words**.
Do not supplement it from another database or external dictionary. Stop the local API before cutover.

From the repository root:

~~~powershell
pnpm db:restructure --source-env C:/path/to/source/.env --target-name lexiplay_clean_TIMESTAMP --expected-words 156600 --connect
~~~

This takes a complete recovery dump and exact dictionary JSONL snapshot, creates a new database,
applies Prisma migrations, and verifies every spelling, meaning and source metadata.
Accounts, personal words and games start empty. The source database stays intact.
An existing destination is rejected. --connect updates only this checkout's ignored .env after verification.

The canonical migration refuses a populated legacy database. Do not bypass that guard.
Normal schema changes on an already canonical database use pnpm db:migrate:local (Prisma migrate deploy).

## Later dictionary maintenance

First generate a difference report. This command does not change the database:

~~~powershell
pnpm library:publish --dictionary .local-backups/SELECTED/dictionary.jsonl.gz --expected-words 156600
~~~

Review additions, changed meanings/source metadata, removals and affected personal/collection references.
Wait for further instruction; do not automatically resolve or delete referenced entries.
After explicit approval, stop API writers and apply the exact reviewed report:

~~~powershell
pnpm library:publish --dictionary .local-backups/SELECTED/dictionary.jsonl.gz --expected-words 156600 --apply .local-backups/REPORT/differences.json --writers-paused
~~~

The command rejects stale reports and unresolved removal references, and backs up before changing data. One transaction publishes the dictionary,
rebuilds official memberships/family links, renews saved collections, and cancels unplayable active games.
It never adds dictionary entries from collection or family files.
Playable games resume with current definitions. Cancelled games refund the original payer once and do not count as wins/losses.
Clients invalidate cached definitions and collections when the single cache version changes.

Connections in the private root `.env`: source → `DATABASE_URL`; target → `SEED_DATABASE_URL`. Pause the application first.

~~~json
{"term":"cover","definition":"To place over.","part_of_speech":["verb"],"senses":[{"partOfSpeech":"verb","definitions":["To place over."],"source":"original source"}]}
~~~

Preserve additional source fields; do not fabricate provenance. Spellings are case-sensitive; search is case-insensitive.
Gameplay deduplicates eligible lowercase ASCII spellings.

Backups: `.local-backups/lexiplay_prisma_TIMESTAMP/target-before.dump`, `users-before.dump`; verification: `preview.json`, `applied.json`. Resume the application with matching code after successful verification. For rollback, restore the full backup into a separate empty database, then switch the service connection.
