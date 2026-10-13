# LexiPlay

**v0.1 · Ready for release** — The first complete vocabulary practice release. See [milestones and roadmap](MILESTONES.md) for completed features, current limits, and future plans.

LexiPlay is a vocabulary practice app built with React, NestJS, and PostgreSQL. Learners play word puzzles, practise saved vocabulary, track Statistics, and manage accounts with optional email recovery.

## Run locally

Install Node.js 22+, pnpm 11.25.0, and Docker Desktop. In the repository root:

```powershell
pnpm install
if (!(Test-Path .env)) { Copy-Item .env.example .env }
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
docker compose up -d database
pnpm dev
```

Open the URL printed by the launcher. On first setup, populate the dictionary using the local `docs/DATABASE-MANUAL.md`; a copied production database already includes it. Development uses a local database and email previews. Local `docs/DEVELOPMENT.md` covers conventions and tests.

For a fresh local database without dictionary entries, run this before starting games. It loads the local `.env` explicitly:

```powershell
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
node --env-file=.env apps/api/node_modules/tsx/dist/cli.mjs apps/api/src/modules/word-lists/seed-simple-wiktionary.ts
```

## Documentation

Documentation is kept locally under `docs/` and excluded from Git. The former `outputs/docs/` documents are merged into `docs/design/`. New clones do not include these local files; retain a separate private copy if you need them on another computer. Both `docs/` and future `outputs/` content are ignored.

- `docs/README.md`: documentation index.
- `docs/DATABASE-MANUAL.md`: connections, operations, updates, backups, recovery, and parallel environments.
- `docs/DEPLOYMENT.md`: Render settings and deliberate releases.
- `docs/GAMES_AND_ACCOUNTS.md`: gameplay, Statistics, and account/email behavior.
- `docs/learn.md`: file responsibilities, data structures, and request flows.
- `docs/design/`: product requirements and technical/word-list designs.

## Repository

| Directory | Responsibility |
| --- | --- |
| `apps/web` | React browser experience |
| `apps/api` | NestJS API, business rules, PostgreSQL repositories |
| `packages/shared` | Shared contracts and historical vocabulary/source notices |
| `docs` (local, ignored) | Operational/development guides, designs, references, historical records |

## Checks and releases

```powershell
pnpm test
pnpm typecheck
pnpm build
```

Persistence tests need a separate disposable `lexiplay_test_*` database; GitHub CI supplies one. Production serves the built React app and API from one origin using `pnpm build` and `pnpm start` with Render's server settings. Push reviewed feature branches, merge code into `main`, and deploy deliberately. Git does not copy database data.

The repository remote is `https://github.com/Hwent/Lexiplay.git`. Configuration files, mail previews, and local database backups remain private and outside Git.
