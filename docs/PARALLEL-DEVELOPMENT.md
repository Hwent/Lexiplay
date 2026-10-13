# Production and local development

Production and development run the same application code against independent databases. The local database is a point-in-time copy, not a continuously synchronized replica.

| Setting | Production on Render | Local development |
| --- | --- | --- |
| Code | Released commit on `main` | Current feature branch |
| Start | `node apps/api/dist/main.js` | `pnpm dev` |
| Database | Render internal URL in Render environment | Docker database URL in private root `.env` |
| Browser | Public HTTPS origin | URL printed by the dev launcher |
| Email | Resend sender | Private previews under `apps/api/.local-mail` |
| Sessions | Production cookies | Separate cookies and new local sign-in |

## Run the development copy

```powershell
cd C:\Users\William\Desktop\LexiPlay
# Clear a stale shell override so the launcher loads DATABASE_URL from .env.
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
docker compose up -d database
pnpm dev
```

The copy tool updates `.env` to point at a fresh database named `lexiplay_dev_<timestamp>` on `127.0.0.1:5432`. Timestamps are UTC. Existing databases are preserved. No dictionary seed is needed after copying.

`pnpm dev` rejects remote database URLs and forces development mode, loopback binding, Vite serving, and local email previews. Direct API/import commands do not use this launcher guard. Keep `.env` local and production administration credentials in `.env.deploy`. Do not use a tunnel to production as the development database. Shell variables override `.env`; clear a stale `DATABASE_URL` before launching.

Accounts, password hashes, personal words, and game history are copied. Active sessions and verification/reset actions are omitted, so sign in locally again using existing account credentials. Browser-only storage is not copied from the production origin. Production progress continues independently.

## Refresh from production

The private `.env.deploy` must contain `SEED_DATABASE_URL` with the production external URL. Docker Desktop must be running, the `postgres:17-alpine` image must be available, and Render must permit the external connection. Run:

```powershell
node --env-file=.env.deploy scripts/copy-production-to-local.mjs
```

The tool opens a verified-TLS, repeatable-read, read-only production transaction. It exports a snapshot, copies the application's `public` schema with PostgreSQL 17 `pg_dump`, and restores into a new local database in a single transaction. Every restored table's row count is checked against the same snapshot, with session/action counts intentionally zero, before `.env` is switched. Production roles, permissions, server settings, and other schemas are not copied. Production rows and schema are unchanged.

Every refresh creates another independent database. Restart `pnpm dev` afterwards. Previous development databases remain available; the fresh copy does not merge local edits.

Private archives, the previous `.env`, and a verification report are stored under Git-ignored `.local-backups/<database-name>/`. They contain production-derived data and credentials and should stay private on this computer. A failed restore can leave a new empty database and an archive. Existing databases remain intact. `.env` switches only after verification; if writing configuration or the report fails, check `.env` before retrying.

PostgreSQL documents consistent dumps while the source is in use and selective restores: [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html).

## Develop and release independently

1. Work on a feature branch, such as `codex/game-ui-and-pasted-words`, against the local copy. Run `pnpm test`, `pnpm typecheck`, and `pnpm build`.
2. Commit and push the feature branch. This does not deploy production when Render uses `main` with manual deployment as described in [DEPLOYMENT.md](DEPLOYMENT.md). No database contents are pushed by Git.
3. Review and merge code into `main`, then deliberately deploy that commit through Render. Keep production database and email settings in Render.
4. Apply intentional production data/schema changes separately. Never restore development data over production. Back up production before schema-changing releases; reverting code does not revert database changes. Schema initialization is currently lazy inside repositories, so review their SQL before release.

Use a separate disposable `lexiplay_test_*` database for persistence tests. The development copy is not the disposable test database. Refreshing development is one-way; data never synchronizes back to production automatically.
