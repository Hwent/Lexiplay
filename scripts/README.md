# Script usage

Run commands from the repository root after `pnpm install`. Use Node.js 22+ and pnpm 11.25.0; database backup/copy commands also need Docker and PostgreSQL 17.

## Development and checks

| Command | Usage |
| --- | --- |
| `pnpm dev` | Runs `dev.mjs`: loads `.env`, generates the Prisma client, and starts the API and Vite on available local ports. Requires a local database; uses local email previews. |
| `pnpm start` | Starts the built API; run `pnpm build` first. |
| `pnpm build` | Builds workspace packages. |
| `pnpm typecheck` | Checks workspace TypeScript. |
| `pnpm test` | Runs workspace application tests. Persistence tests require a disposable `lexiplay_test_*` database through `TEST_DATABASE_URL`. |

`prepare-test-database.mjs` is called automatically by the API test command. It applies local migrations when `TEST_DATABASE_URL` is set and otherwise does nothing.

## Vocabulary data

| Command | Usage |
| --- | --- |
| `pnpm cefr:build` | Runs `build-cefr-pools.mjs`: rebuilds the A1–C1 pool JSON files from local `test_materials/en-LEVEL.json` source files. |
| `pnpm cefr:audit-families --report .local-backups/cefr-family-audit.json` | Runs `audit-cefr-families.mjs`: reports family coverage without changing collections or the database. Accepts `--directory PATH` for the family source and `--require-complete` to exit with code 2 if unresolved entries remain. |
| `pnpm cefr:build-families` | Runs `build-cefr-families.mjs`: rebuilds the API family mapping and public family/C2 exports. Accepts an optional positional source directory. |
| `pnpm cefr:expand-c2` | Runs `expand-c2.mjs`: expands the C2 pool using the pinned Octanove CSV, published family lists and definitions in the local database. Writes the pool JSON and an import report. |
| `pnpm dictionary:wordnet` | Previews the WordNet supplement in a rolled-back transaction. Add `--apply` to back up and apply it. See the [importer guide](../apps/api/src/modules/word-lists/WORDNET-IMPORT.md). |

Family tools default to `.local-backups/word-families/bnc-coca/basewrd1.txt` through `basewrd25.txt`. The C2 expansion additionally needs `.env` and `.local-backups/c2-expansion/octanove-vocabulary-profile-c1c2-1.0.csv`. See [CEFR word families](CEFR-WORD-FAMILIES.md) for source setup and attribution.

## Database operations

| Command | Usage |
| --- | --- |
| `pnpm db:migrate:local` | Runs `migrate-local-collections.mjs`: loads `.env`, baselines an existing legacy schema when needed, and applies Prisma migrations. Accepts only a local `DATABASE_URL`. |
| `node scripts/copy-production-to-local.mjs` | Reads production from `SEED_DATABASE_URL` in the shell or `.env.deploy`, backs up and restores into a new local database, verifies row counts, and updates `.env`. Excludes session/action rows and preserves the previous `.env` in the backup folder. |
| `node --env-file=.env.deploy scripts/seed-deployed.mjs` | Imports Simple English Wiktionary into an empty deployed dictionary using `SEED_DATABASE_URL`. Requires `pnpm build` and typing `SEED` at the prompt. Skips an already populated dictionary. |
| `pnpm db:redeploy prepare --mode fresh` | Runs `database-redeploy.mjs`: prepares a replacement database bundle without production accounts/progress. Merge mode and publishing are covered in the [redeployment guide](DATABASE-REDEPLOY.md). |
| `pnpm db:redeploy:prisma --source-database SOURCE --target-database TARGET --strict-dictionary` | Runs `prisma-redeploy.ts`: previews a schema/public-data update on an isolated clone while preserving target users. Reads source `.env` and target `.env.deploy`; add `--apply` to update the target after pausing the application. See the [redeployment guide](DATABASE-REDEPLOY.md). |

Backups and generated reports stay under ignored `.local-backups/`.

## Shared script modules

These files are imported by the commands above:

| Module | Purpose |
| --- | --- |
| `dev-environment.mjs` | Validates the development database URL and sets local runtime defaults. |
| `copy-production-config.mjs` | Loads and validates the external production copy connection. |
| `database-redeploy-core.mjs` | Provides database compatibility checks, fingerprints and public-data merge operations. |
| `csv-records.mjs` | Parses CSV records for C2 expansion. |
| `sql-statements.mjs` | Splits migration SQL for Prisma redeployment. |
