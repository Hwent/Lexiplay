# LexiPlay

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

Open the URL printed by the launcher. On first setup, populate the dictionary using the [database manual](docs/DATABASE-MANUAL.md); a copied production database already includes it. Development uses a local database and email previews. See [Development](docs/DEVELOPMENT.md) for conventions and tests.

## Documentation

The [documentation index](docs/README.md) organizes current guides, design documents, reference material, and historical records.

- [Database manual](docs/DATABASE-MANUAL.md): terminal/DBeaver connections, operations, updates, backups, recovery, and independent production/development databases.
- [Deployment](docs/DEPLOYMENT.md): Render settings and deliberate releases.
- [Games and accounts](docs/GAMES_AND_ACCOUNTS.md): gameplay, Statistics, account controls, and email behavior.
- [Codebase tour](docs/learn.md): file responsibilities, data structures, and request flows.

## Repository

| Directory | Responsibility |
| --- | --- |
| `apps/web` | React browser experience |
| `apps/api` | NestJS API, business rules, PostgreSQL repositories |
| `packages/shared` | Shared contracts and historical vocabulary/source notices |
| `docs` | Current operational/development guides, reference material, historical records |
| `outputs/docs` | Product requirements and technical/word-list designs |

## Checks and releases

```powershell
pnpm test
pnpm typecheck
pnpm build
```

Persistence tests need a separate disposable `lexiplay_test_*` database; GitHub CI supplies one. Production serves the built React app and API from one origin using `pnpm build` and `pnpm start` with Render's server settings. Push reviewed feature branches, merge code into `main`, and deploy deliberately. Git does not copy database data.

The repository remote is `https://github.com/Hwent/Lexiplay.git`. Configuration files, mail previews, and local database backups remain private and outside Git.
