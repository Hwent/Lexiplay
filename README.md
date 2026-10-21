# LexiPlay

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

Word Guess offers a definition hint for 1 coin from the local dictionary. Failed or unavailable hints cost nothing. Purchased hints stay visible while the puzzle is active, and their fees are not refunded when leaving a puzzle.

Community shows the top 20 registered accounts by current coin balance at
`GET /community/coin-rankings`. Names are masked on the server as `w***`;
equal balances share a rank. Guest wallets are not listed.

Settings provides compact controls for appearance, three text sizes, interface language and sound. The interface follows the browser's English or Chinese preference by default; learners can choose English or Simplified Chinese manually. These preferences stay on the device. Learning words, parts of speech and dictionary definitions stay in English.

The Feedback page accepts messages from accounts and guests without requiring a game first. `POST /api/v1/feedback` accepts `{ "content": "Your feedback" }` (1–2,000 characters). The server identifies the sender from cookies and stores the message in `message` with exactly one account or guest-session reference and a creation timestamp. Messages are not publicly readable. Deleting a sender’s account or guest session also deletes its messages.

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

Persistence tests need a separate disposable `lexiplay_test_*` database; GitHub CI supplies one. Production serves the built React app and API from one origin using `pnpm build` and `pnpm start` with Render's server settings. `pnpm start` applies pending Prisma migrations before launching the API and stops if a migration fails. Keep Render's start command set to `pnpm start`; building generates the Prisma client but does not migrate the database. Push reviewed feature branches, merge code into `main`, and deploy deliberately. Git does not copy database data.

The repository remote is `https://github.com/Hwent/Lexiplay.git`. Configuration files, mail previews, and local database backups remain private and outside Git.
