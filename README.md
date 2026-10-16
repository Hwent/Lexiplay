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
pnpm db:migrate:local
pnpm dev
```

Open the URL printed by the launcher. On first setup, populate the dictionary using the local `docs/DATABASE-MANUAL.md`; a copied production database already includes it. Development uses a local database and email previews. Local `docs/DEVELOPMENT.md` covers conventions and tests.

Keep environment settings in the private root `.env`: `DATABASE_URL` for local development and `SEED_DATABASE_URL` for production backups. See `.env.example` for placeholders. Use a database with the schema from `dcdf5ef`; reverting application code does not roll back database migrations.

For a fresh local database, publish a reviewed dictionary using `pnpm library:publish`. Use `pnpm db:restructure` to prepare a backed-up replacement from an older local schema. See [database maintenance](scripts/DATABASE-REDEPLOY.md) for the required arguments and verification steps.

## Documentation

Dictionary publication preserves referenced entries and updates the library revision so clients refresh cached vocabulary. License notices are shipped under `apps/web/public/licenses/`.

Each puzzle offers a synonym-or-category hint and a definition hint for 1 coin each. Synonyms and category fallbacks use the [Datamuse API](https://www.datamuse.com/api/); definitions use the local dictionary. Failed or unavailable hints cost nothing. Purchased hints stay visible while the puzzle is active, and their fees are not refunded when leaving a puzzle.

Game pools use lowercase alphabetic entries and exclude entries tagged as proper nouns or names. The collection picker counts distinct playable words at the selected length using the same rules.

Documentation is kept locally under `docs/` and excluded from Git. New clones do not include these local files; retain a separate private copy if you need them on another computer. Generated outputs, dictionary source materials, and database dumps are also ignored; application vocabulary data, import fixtures, migrations, and license notices remain tracked.

- `docs/README.md`: documentation index.
- `docs/DICTIONARY.md`: source decisions and dictionary imports.
- `docs/DATABASE-MANUAL.md`: connections, operations, updates, backups, recovery, and parallel environments.
- `docs/DEPLOYMENT.md`: Render settings and deliberate releases.
- [Database redeployment commands](scripts/DATABASE-REDEPLOY.md): fresh replacement or production-user-preserving merge, backups, verification and cutover.
- `docs/GAMES_AND_ACCOUNTS.md`: gameplay, Statistics, and account/email behavior.
- `docs/learn.md`: file responsibilities, data structures, and request flows.
- `docs/design/`: product requirements and technical/word-list designs.

## Repository

| Directory | Responsibility |
| --- | --- |
| `apps/web` | React browser experience |
| `apps/api` | NestJS API, business rules, PostgreSQL repositories |
| `packages/shared` | Shared contracts and historical vocabulary/source notices |
| `scripts` | Data generation and database operations |
| `docs` (local, ignored) | Operational/development guides, designs, references, historical records |

## Checks and releases

```powershell
pnpm test
pnpm typecheck
pnpm build
```

Persistence tests need a separate disposable `lexiplay_test_*` database; GitHub CI supplies one. Production serves the built React app and API from one origin using `pnpm build` and `pnpm start` with Render's server settings. Push reviewed feature branches, merge code into `main`, and deploy deliberately. Git does not copy database data.

The repository remote is `https://github.com/Hwent/Lexiplay.git`. Configuration files, mail previews, and local database backups remain private and outside Git.
