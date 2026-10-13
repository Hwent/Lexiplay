# LexiPlay database manual

This manual covers PostgreSQL connections, routine operations, dictionary and schema updates, backups, and recovery. Examples use PowerShell from the repository root unless marked SQL. Commands in this document are instructions, not automatic jobs. Production writes and restores require a deliberate maintenance decision.

Related guides: [documentation index](README.md), [local development](DEVELOPMENT.md), and [Render deployment](DEPLOYMENT.md).

## 1. Environments and database names

| Environment | Database | Configuration | Purpose |
| --- | --- | --- | --- |
| Local default | `lexiplay` | Docker Compose | Initial local setup |
| Local production copy | `lexiplay_dev_<UTC timestamp>` | Root `.env`: `DATABASE_URL` | Development against a snapshot |
| Disposable tests | `lexiplay_test_*` | Shell `TEST_DATABASE_URL` | Persistence tests |
| Production | Render database | Render service: internal `DATABASE_URL` | Live application |
| Production administration | Same Render database | Private `.env.deploy`: external `SEED_DATABASE_URL` | Read-only copy tool and first dictionary import |

Do not substitute the default `lexiplay` database for the development copy accidentally. Check the current local name in `.env`, under `DATABASE_URL`, or in `.local-backups/<copy-name>/verification.json`.

The copy script generates names with `new Date().toISOString().replace(/[-:TZ.]/g, '')`. For example, `lexiplay_dev_20261013032402379` identifies a copy started at **2026-10-13 03:24:02.379 UTC**. The example name is historical; refreshes generate new names.

Local and production databases are independent. Git transfers code, not database contents. Never restore local development data over production as a deployment step. `pnpm dev` blocks remote database URLs and previews email locally; direct import/administration commands do not have that launcher guard.

## 2. Connect from the terminal

Start Docker Desktop, then:

```powershell
cd C:\Users\William\Desktop\LexiPlay
docker compose up -d database
docker compose ps
docker compose exec database psql -U lexiplay -d postgres
```

Inside `psql`:

```text
\l
\connect lexiplay_dev_20261013032402379
\conninfo
\dt public.*
\d public.dictionary_words
\q
```

Replace the example copy name with your current `.env` name. To connect directly:

```powershell
$devDb = 'lexiplay_dev_20261013032402379'
docker compose exec database psql -U lexiplay -d $devDb
```

`docker compose stop database` stops PostgreSQL while retaining its named volume. `docker compose up -d database` starts it again. Do not use `docker compose down -v` for routine shutdown: it removes the volume containing all local databases.

For production terminal access, Render supplies a PSQL Command under the database's Connect/External or Info view. It requires PostgreSQL client tools. Keep the full password-bearing URL out of chat, screenshots, Git, and command history; prefer connection fields and an interactive password prompt. Use the external hostname from your computer, and TLS. Render's internal connection is for services in the same region. [Render connection documentation](https://render.com/docs/postgresql-creating-connecting).

## 3. Connect with DBeaver

Create separate PostgreSQL connections and give them clear names:

| Field | LexiPlay Local Dev | LexiPlay Production |
| --- | --- | --- |
| Host | `127.0.0.1` | Full Render external hostname |
| Port | `5432` | `5432` |
| Database | Current `lexiplay_dev_*` name | Database name from Render |
| Username | `lexiplay` | User from Render |
| Password | `lexiplay` (local only) | Private password from Render |
| SSL | Not needed for this local Docker server | Required; `sslmode=require` is Render's baseline |

Use Database → New Database Connection → PostgreSQL, enter the fields, then Test Connection and Finish. An external URL has the form `postgresql://USER:PASSWORD@HOST/DATABASE`; it contains all the connection fields. If credentials contain percent escapes, use Render's individual fields or URL-aware connection input rather than copying escaped text into the password field.

Expand Databases → your database → Schemas → public → Tables. Open SQL Editor to run the SQL below. SQL statements do not include `psql` commands such as `\dt`. Use manual transactions for edits so you can review before committing; a saved DBeaver connection may have auto-commit enabled.

If production times out, check Render's external IP allow list. If TLS fails, use the full external hostname and a current driver; do not disable SSL. Our copy tool uses certificate and hostname verification (`verify-full`). See [DBeaver connection documentation](https://dbeaver.com/docs/dbeaver/Create-Connection/).

## 4. Tables and routine inspection

| Table | Stores |
| --- | --- |
| `dictionary_words` | Shared definitions and parts of speech; game answers and accepted guesses |
| `account_users` | Account identity and password hashes |
| `account_sessions` | Hashed session tokens and expiration |
| `account_actions` | Hashed reset/verification tokens and expiration |
| `user_word_lists` | One personal list per account |
| `user_words` | Personal vocabulary and Known/Unfamiliar status |
| `practice_games` | Owner key and serialized game state |
| `practice_guesses` | Ordered guess results for each game |
| `guest_progress_claims` | Guest-to-account ownership claims |
| `progress_transfers` | Idempotent transfer receipts |

Confirm the database before running queries:

```sql
SELECT current_database(), current_user, inet_server_addr(), version();
SELECT count(*) AS dictionary_entries FROM public.dictionary_words;
SELECT count(*) AS accounts FROM public.account_users;
SELECT count(*) AS games FROM public.practice_games;
SELECT count(*) AS personal_words FROM public.user_words;
SELECT term, definition, part_of_speech
FROM public.dictionary_words WHERE term IN ('apple', 'because', 'tear') ORDER BY term;
```

For inspection that must not write, use an explicit read-only transaction:

```sql
BEGIN READ ONLY;
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
SELECT term FROM public.dictionary_words WHERE term LIKE 'app%' ORDER BY term LIMIT 20;
ROLLBACK;
```

HTTP health checks establish server startup, not database readiness. Check dictionary search, vocabulary ranges, and account/game behavior as appropriate. Existing games retain their stored answer/guess pool; changing dictionary rows does not rewrite those games.

## 5. Update data deliberately

Prefer application/API operations for account and personal-word changes: they enforce ownership, validation, password hashing, cascading cleanup, and transfer rules. Do not set password hashes manually or delete accounts with a bare SQL statement; game owner keys also need cleanup.

For a targeted dictionary correction, take a backup and rehearse in the local copy. This example is a preview that rolls back:

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT term, definition FROM public.dictionary_words WHERE term = 'apple' FOR UPDATE;
UPDATE public.dictionary_words
SET definition = 'A fruit.'
WHERE term = 'apple'
RETURNING term, definition;
ROLLBACK;
```

Use a specific `WHERE` clause, check the affected row count, and record the original value. Only replace `ROLLBACK` with `COMMIT` when the actual target and change have been reviewed. After a committed change, verify search and a newly created game. A commit cannot be undone with a later `ROLLBACK`; correct the specific row from its recorded value or recover from backup.

### Remove an obsolete local copy

First read the active database name in `.env`, disconnect DBeaver from the old copy, and preserve any needed backup or local work. This command deletes only the explicitly selected old database; it is not a reset procedure and must not target the active development or production database:

```powershell
$oldDb = Read-Host 'Exact name of the obsolete LOCAL database'
if ($oldDb -notmatch '^lexiplay_(dev|recovery)_\d+$') { throw 'Expected a named local copy or recovery database.' }
docker compose exec database dropdb -U lexiplay --interactive $oldDb
```

Review the database name at the interactive prompt before confirming. Do not add `--force`; an active connection should prevent removal. This cleanup is not performed by the copy tool.

### Refresh the local dictionary from Wiktionary

The seed command stages the import and replaces shared dictionary rows after validation. It preserves the prior dictionary if import/validation fails. It also creates the dictionary table if needed; schema setup is separate from the final data replacement.

Use `.env` explicitly for this standalone command so it targets the current development copy rather than the default local database:

```powershell
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
node --env-file=.env apps/api/node_modules/tsx/dist/cli.mjs apps/api/src/modules/word-lists/seed-simple-wiktionary.ts
```

First check that `.env` points to local Docker and back up any manual dictionary corrections. Reimport replaces those corrections. Internet access is required. Numbered parts of speech such as `Noun 1` are supported; definitions keep the first two distinct senses. Deploying a parser fix alone does not repair rows imported earlier.

### Production dictionary and schema updates

`node --env-file=.env.deploy scripts/seed-deployed.mjs` is for the **first import only**. It requires a build and explicit `SEED` input, and skips an existing populated dictionary. It is not a production-refresh command.

For a production dictionary refresh, back up production, rehearse the updated importer locally, confirm the intended target, and arrange a maintenance window. Create a separate Git-ignored `.env.production-admin` file containing only the production administration setting below; obtain the current external URL from Render and preserve its existing parameters when adding `sslmode=verify-full`. Never repoint development `.env`.

```dotenv
DATABASE_URL=postgresql://<USER>:<PASSWORD>@<EXTERNAL_HOST>/<DATABASE>?sslmode=verify-full
```

After reviewing that private file and verifying a usable backup, this command **replaces the production shared dictionary** with a fresh Wiktionary import. It does not update personal copies or rewrite existing games:

```powershell
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
node --env-file=.env.production-admin apps/api/node_modules/tsx/dist/cli.mjs apps/api/src/modules/word-lists/seed-simple-wiktionary.ts
```

Run it only as the intended production maintenance operation, then verify the entry count, `because`, `tear`, search, and a new game. A failure before data replacement preserves the prior dictionary. This documentation change does not execute the command.

There is no standalone versioned migration runner yet. Account, word-list, dictionary, and game repositories initialize/alter schemas on first use. Some SQL drops obsolete columns, truncates definitions, or merges lists. Review repository SQL as part of a release, test on a fresh production copy, and back up production before deploying schema-changing code. A code rollback does not reverse committed schema/data changes.

## 6. Copy production for development

```powershell
node --env-file=.env.deploy scripts/copy-production-to-local.mjs
```

This reads a consistent production snapshot, restores the application's `public` schema into a new local database, verifies table counts, and updates local `.env`. It preserves existing local databases. The private `.env.deploy` must contain the external `SEED_DATABASE_URL`; Docker must be running and Render must permit your connection. Restart `pnpm dev` and update DBeaver's database field after switching copies. Previous local edits are preserved in the old database, not merged into the fresh copy. `previous.env` records the prior private configuration. If a configuration/report write fails, inspect `.env` before retrying.

**This is a development copy, not a complete disaster-recovery backup.** It omits session/action rows, database roles/permissions, server settings, and non-public schemas. Archives and reports live in Git-ignored `.local-backups`. Its row-count report verifies the exported snapshot, not today's changing production counts.

### Run production and development in parallel

| Setting | Production | Local development |
| --- | --- | --- |
| Code | Released `main` commit | Feature branch |
| Start | Compiled API serves the React build | `pnpm dev` runs API and Vite |
| Database | Render internal URL | Local Docker copy selected by `.env` |
| Browser/email | Public HTTPS origin and Resend | Printed local URL and private email previews |

After copying, clear a stale shell database override and start development:

```powershell
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
docker compose up -d database
pnpm dev
```

Sign in locally again: sessions and browser-origin storage are not transferred. Develop on a feature branch, run checks, and commit/push code for review. With Render configured for `main` and manual deploys, a feature-branch push does not release it. Review/merge into `main`, then deliberately deploy that commit. Database refreshes are one-way production-to-local; production data and email settings remain in Render. Keep a separate disposable `lexiplay_test_*` database for persistence tests. Details of code release and production environment settings are in [Deployment](DEPLOYMENT.md).

## 7. Backups

Record source environment, database, timestamp, PostgreSQL version, archive format, code commit, and whether any data was omitted. Keep production-derived archives private and outside Git. Keep a protected copy outside this workstation if it is needed for disaster recovery. A backup is useful only after a successful restore rehearsal.

### Back up a local database

Choose the current local name; use a fresh timestamped filename:

```powershell
$devDb = 'lexiplay_dev_20261013032402379'
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss_fff'
$backupDir = Join-Path (Get-Location) '.local-backups'
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$archive = "${devDb}_${stamp}.dump"
$container = docker compose ps -q database
docker compose exec -T database pg_dump -U lexiplay -d $devDb --format=custom --no-owner --no-acl --file="/tmp/$archive"
if ($LASTEXITCODE -ne 0) { throw 'Local dump failed.' }
docker cp "${container}:/tmp/$archive" (Join-Path $backupDir $archive)
if ($LASTEXITCODE -ne 0) { throw 'Archive copy failed.' }
```

The custom archive contains the local database's schema and data, including its own sessions/actions, unlike the development-copy archive. No existing rows are changed. PostgreSQL custom archives are restored with `pg_restore`, not `psql`. [PostgreSQL pg_dump documentation](https://www.postgresql.org/docs/17/app-pgdump.html).

### Back up production

Check the actual plan in Render. Paid databases provide point-in-time recovery and logical exports; Free databases do not provide Render-managed recovery or exports. For a paid database, use its Recovery page → Create export and download the result. Render exports are directory-format `.dir.tar.gz` archives, not the custom `.dump` files above. [Render backup documentation](https://render.com/docs/postgresql-backups).

For a Free database or a manual backup, use PostgreSQL 17 client tools (matching the current server major version) through Docker. This recipe uses connection fields and a hidden password prompt instead of a credential-bearing URL in command history. It copies the application's `public` schema, including sessions/actions; it does not copy cluster roles or other schemas. Use a dedicated PowerShell window so these temporary variables cannot override unrelated commands.

```powershell
$backupDir = Join-Path (Get-Location) '.local-backups'
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$archive = 'production_full_' + (Get-Date -Format 'yyyyMMdd_HHmmss_fff') + '.dump'
$env:PGHOST = Read-Host 'Render external hostname'
$env:PGDATABASE = Read-Host 'Render database name'
$env:PGUSER = Read-Host 'Render username'
$secret = Read-Host 'Render password' -AsSecureString
$env:PGPASSWORD = [System.Net.NetworkCredential]::new('', $secret).Password
$env:PGPORT = '5432'
$env:PGSSLMODE = 'verify-full'
$env:PGSSLROOTCERT = '/etc/ssl/certs/ca-certificates.crt'
$env:PGCONNECT_TIMEOUT = '20'
$env:PGOPTIONS = '-c default_transaction_read_only=on'
try {
  docker run --rm --env PGHOST --env PGPORT --env PGDATABASE --env PGUSER --env PGPASSWORD --env PGSSLMODE --env PGSSLROOTCERT --env PGCONNECT_TIMEOUT --env PGOPTIONS --mount "type=bind,source=$backupDir,target=/backup" postgres:17-alpine pg_dump --format=custom --schema=public --no-owner --no-acl --lock-wait-timeout=10s --file="/backup/$archive"
  if ($LASTEXITCODE -ne 0) { throw 'Production backup failed; do not treat a partial file as a backup.' }
} finally {
  'PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSSLMODE','PGSSLROOTCERT','PGCONNECT_TIMEOUT','PGOPTIONS' | ForEach-Object { Remove-Item -LiteralPath "Env:$_" -ErrorAction SilentlyContinue }
  $secret.Dispose()
}
```

This is a production **read**, not a refresh or restore. Do not run dictionary seeding or other writers while intending to back up. Use a client version at least as new as the server major version; upgrade the image when the database major version changes.

## 8. Recover into a new local database

Stop the dev launcher with Ctrl+C. Keep PostgreSQL running. Choose a trusted custom-format archive from section 7 or the copy tool. This recipe creates a new database and never drops the existing one:

```powershell
$backupFile = (Resolve-Path '.local-backups/REPLACE_WITH_ARCHIVE.dump').Path
$restoreDb = 'lexiplay_recovery_' + (Get-Date -Format 'yyyyMMdd_HHmmss_fff')
$container = docker compose ps -q database
docker compose exec -T database createdb -U lexiplay $restoreDb
if ($LASTEXITCODE -ne 0) { throw 'New recovery database could not be created.' }
docker cp $backupFile "${container}:/tmp/$restoreDb.dump"
if ($LASTEXITCODE -ne 0) { throw 'Archive copy failed.' }

# Render can explicitly dump public, while createdb already supplies that schema.
$toc = docker compose exec -T database pg_restore --list "/tmp/$restoreDb.dump"
if ($LASTEXITCODE -ne 0) { throw 'Archive inspection failed.' }
$listFile = Join-Path (Get-Location) ".local-backups/$restoreDb.list"
[IO.File]::WriteAllLines($listFile, @($toc | Where-Object { $_ -notmatch '^\d+; \d+ \d+ (?:SCHEMA - public|COMMENT - SCHEMA public)(?:\s|$)' }), [Text.UTF8Encoding]::new($false))
docker cp $listFile "${container}:/tmp/$restoreDb.list"
if ($LASTEXITCODE -ne 0) { throw 'Restore list copy failed.' }
docker compose exec -T database pg_restore -U lexiplay --dbname=$restoreDb --no-owner --no-acl --single-transaction --exit-on-error --use-list="/tmp/$restoreDb.list" "/tmp/$restoreDb.dump"
if ($LASTEXITCODE -ne 0) { throw 'Restore failed; keep the current development database selected.' }
docker compose exec database psql -U lexiplay -d $restoreDb
```

Check the database name, expected tables, row counts, dictionary examples, and referential integrity against the backup's records. Copy-tool archives should match `verification.json`; their session/action tables should be empty. For a normal backup, compare with counts recorded when the backup was taken. Then change only `.env`'s database name and DBeaver's local database field, clear a stale shell `DATABASE_URL`, restart development, and test dictionary search, sign-in, and a new game. Keep the previous database until recovery is accepted.

For a restored application database, these ownership/reference checks should return zero:

```sql
SELECT count(*) AS orphan_guesses
FROM practice_guesses guesses LEFT JOIN practice_games games ON games.id = guesses.game_id
WHERE games.id IS NULL;
SELECT count(*) AS orphan_words
FROM user_words words LEFT JOIN user_word_lists lists ON lists.id = words.list_id
WHERE lists.id IS NULL;
SELECT count(*) AS orphan_account_games
FROM practice_games games
LEFT JOIN account_users users ON games.owner_key = 'user:' || users.id::text
WHERE games.owner_key LIKE 'user:%' AND users.id IS NULL;
```

This custom-archive recipe does not accept Render's `.dir.tar.gz` exports. Extract those into a private directory, identify the archive directory containing `toc.dat`, and use `pg_restore` with that directory instead of a `.dump` file. Rehearse the format-specific restore in a new database. [PostgreSQL pg_restore documentation](https://www.postgresql.org/docs/17/app-pgrestore.html).

## 9. Recover production

1. Identify the incident time, affected tables, and last known good backup. Preserve the current state where possible; do not immediately delete or overwrite the damaged database.
2. Stop application writes during a logical-restore/cutover maintenance window. Prefer Render point-in-time recovery if the actual plan supports it: restore to a new instance and validate that instance. Free instances need a manual backup; without one, historical account/game data cannot be reconstructed from Git or a Wiktionary reimport.
3. If using a logical backup, restore it into a new empty production instance using its format-specific procedure. Do not use the sanitized development-copy archive as a complete recovery source. Review roles, permissions, schema compatibility, and sessions separately.
4. Compare expected counts and run functional checks against the recovery instance before directing the live application at it. A point-in-time restore loses later writes; handle any needed reconciliation deliberately.
5. Update Render's internal `DATABASE_URL` to the recovery instance and deploy/restart the service. Update private external administration settings and DBeaver separately. These are explicit production actions, not tasks performed by this manual.
6. Verify accounts, vocabulary, games, and new writes; consider invalidating restored sessions/action tokens after a security incident. Retain the former database and backup until recovery is accepted.

Render's Recovery page and supported recovery window depend on the current plan. Check the dashboard rather than assuming recovery is available. [Render recovery procedure](https://render.com/docs/postgresql-backups#perform-a-recovery).

## 10. Troubleshooting and maintenance

| Symptom | Check/action |
| --- | --- |
| Local connection refused | Docker Desktop running; `docker compose ps`; port `127.0.0.1:5432` available |
| Database does not exist | List databases with `\l`; use the current `.env` name after refresh |
| Production password fails | Use current Render credentials; update saved connections/private files after rotation |
| HTTPS production-origin error during local startup | Use `pnpm dev`; it sets development mode. Clear inherited remote `DATABASE_URL` |
| Remote URL blocked by dev launcher | Keep production credentials in `.env.deploy`; point `.env` at Docker |
| Missing dictionary word after parser fix | Inspect `dictionary_words`; rehearse a dictionary refresh. Code deployment alone does not reimport |
| `schema public already exists` on restore | Use the filtered restore-list procedure in section 8; do not drop the existing working database |
| Unsupported dump/server version | Match PostgreSQL client/server major versions; use the appropriate archive format |
| Restore fails midway | `--single-transaction` rolls back restore work; new empty database may remain. Preserve working database and inspect failure |
| Empty sessions after a development refresh | Expected: production sessions/actions were intentionally omitted |
| API runs but games fail | Health is not a database readiness check; inspect dictionary counts and database-backed endpoints |

Do account/session maintenance through reviewed application/admin procedures. For table maintenance, inspect sizes and indexes before scheduling `ANALYZE` or `VACUUM`; do not run `VACUUM FULL` or discard data as routine troubleshooting. Review backup age, available disk space, restore rehearsals, and private-file retention regularly.

If a production password was disclosed, rotate it through Render's supported credential controls and update the dependent service connection, `.env.deploy`, and saved clients. Never put a real URL/password in this manual. No automated backup schedule, retention job, production restore, or versioned migration runner is created by this document.
