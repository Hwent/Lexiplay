# Database maintenance

Prisma migrations are the only schema-change mechanism. Application startup never creates or alters tables.
The schema is [schema.prisma](../apps/api/prisma/schema.prisma); SQL-only constraints and indexes live in its migrations.
There are 14 application tables, plus Prisma's migration bookkeeping table.

## Authoritative data

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

Each input JSONL record retains the selected source shape:

~~~json
{"term":"cover","definition":"To place over.","part_of_speech":["verb"],"senses":[{"partOfSpeech":"verb","definitions":["To place over."],"source":"original source"}]}
~~~

Preserve additional source fields; do not fabricate provenance. Spellings are case-sensitive; search is case-insensitive.
Gameplay deduplicates eligible lowercase ASCII spellings.

## Coins and retries

Wordle costs 1 coin on successful creation. Easy/medium/hard wins credit 4/5/6 coins; losses credit nothing.
A UUID startRequestId makes retries idempotent. Creation failure rolls back the charge; resume is free. Explicit abandonment or replacement refunds the original payer once. Losses are not refunded.
Wallet row locks and the game transaction prevent overspending, repeated rewards and repeated refunds. Cancelled rows are minimal settlement receipts, excluded from history/statistics. Completed rows retain no guesses, hints, definition copies or dictionary foreign keys. Completion time remains for existing streaks and history ordering.
Transferring a guest game changes its owner only. Its rewards/refunds stay in the guest wallet that paid.
New account games use the account wallet; guest balances never become account balances.

## Recovery and checks

Ignored .local-backups/<destination>/ bundles contain source.dump, its SHA-256 manifest,
dictionary.jsonl.gz (initial cutover), and verification.json. Keep these together and private.
The dump is PostgreSQL custom format. Restore it into a **new local database** with pg_restore --exit-on-error --no-owner --no-acl.
Verify the restored dictionary and account counts before pointing .env at it; never restore over a running database.

The maintenance commands use the cached postgres:17-alpine Docker image for pg_dump/pg_restore.
They support local PostgreSQL only and require Docker Desktop.

pnpm test runs API persistence checks against a separate lexiplay_test_* database.
Without TEST_DATABASE_URL, the runner creates a disposable database per worktree using the local .env connection credentials.
CI supplies TEST_DATABASE_URL explicitly. Tests cannot target the connected application database.
