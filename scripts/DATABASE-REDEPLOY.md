# Database redeployment

Prerequisites: Docker, PostgreSQL 17, matching application/schema versions. Backups stay in ignored `.local-backups/`; keep a secure copy elsewhere.

Create private `.env.redeploy`:

```dotenv
# Development defaults to DATABASE_URL from .env.
REDEPLOY_PRODUCTION_URL=postgresql://USER:PASSWORD@HOST/OLD_PRODUCTION
REDEPLOY_TARGET_URL=postgresql://USER:PASSWORD@HOST/NEW_EMPTY_PRODUCTION
```

## 1. Fresh production (no accounts/progress)

```powershell
pnpm db:redeploy prepare --mode fresh
# Use the bundle path printed above:
pnpm db:redeploy publish --bundle .local-backups/lexiplay_redeploy_TIMESTAMP --apply
```

## 2. Preserve production users + development vocabulary

Prepare a local preview while production remains online (preview bundles cannot be published):

```powershell
pnpm db:redeploy prepare --mode merge --preview
```

Pause all production writers first; keep them paused through cutover.

```powershell
pnpm db:redeploy prepare --mode merge --writers-paused
pnpm db:redeploy publish --bundle .local-backups/lexiplay_redeploy_TIMESTAMP --writers-paused
pnpm db:redeploy publish --bundle .local-backups/lexiplay_redeploy_TIMESTAMP --writers-paused --apply
```

`production.dump` is the full backup; `users.dump` holds private-table data. The candidate retains production user IDs, passwords, lists, progress, sessions, games and bookmarks. Development wins matching public vocabulary keys; production-only public rows remain. Development accounts are excluded. Schema/history mismatch stops the merge: upgrade and review a production clone first, then use that clone as `REDEPLOY_PRODUCTION_URL`.

## Cutover / rollback

1. Set the service `DATABASE_URL` to the new target; deploy matching code.
2. Check login, library and game. Clear browser vocabulary caches after dictionary replacement.
3. Resume writers. Retain the old database and backups.

Rollback **before resuming writes**: restore the old service `DATABASE_URL` and code. After writes resume, reconcile new user changes before switching back.

Scripts never clear a populated target. A failed restore is transactional; failed verification leaves the target isolated. Fix the issue and use another empty target. Checksums detect corruption, not malicious edits; treat bundles as private trusted files.

## 3. Update an existing database with Prisma; preserve users

Source connection: private `.env` → `DATABASE_URL`. Target connection: private `.env.deploy` → `SEED_DATABASE_URL`. Pause the application first.

```powershell
# Preview on an isolated target clone; the real target stays unchanged.
pnpm db:redeploy:prisma --source-database lexiplay_dev_20261014011803907 --target-database lexiplay_demo_db --strict-dictionary
# New backup + clone validation + atomic target update:
pnpm db:redeploy:prisma --source-database lexiplay_dev_20261014011803907 --target-database lexiplay_demo_db --strict-dictionary --apply
```

Prisma executes the schema upgrade and public-data writes in one transaction. `--strict-dictionary` fully replaces public dictionary words, definitions, POS and senses from the development snapshot, then verifies exact content equality. Existing user columns are checked before commit; saved legacy words are additionally imported into the new personal-list models. Development accounts are excluded. Multiple legacy lists per user or unmatched saved words stop the update for review. Omitting the strict flag preserves target-only public words.

Backups: `.local-backups/lexiplay_prisma_TIMESTAMP/target-before.dump`, `users-before.dump`; verification: `preview.json`, `applied.json`. Resume the application with matching code after successful verification. For rollback, restore the full backup into a separate empty database, then switch the service connection.

## Local verification

```powershell
docker compose up -d --wait database
$env:TEST_REDEPLOY_URL='postgresql://lexiplay:lexiplay@127.0.0.1:5432/lexiplay'
node --test scripts/database-redeploy.test.mjs
Remove-Item Env:TEST_REDEPLOY_URL
```
