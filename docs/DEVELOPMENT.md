# Development guide

For a guided tour of the current code, file responsibilities, data structures, and technologies, start with [learn.md](learn.md).

Use [GAMES_AND_ACCOUNTS.md](GAMES_AND_ACCOUNTS.md) for current game rules, persistence, Statistics, and account/email setup. The supplied [React standard](react-standard.md) is a reference template; preserve the project’s TypeScript components and existing boundaries.

## Component boundaries

- **Web** owns presentation, navigation, accessibility, and transient input state. It calls the API through a typed client/contract boundary.
- **API** owns authentication, authorization, validation, puzzle rules, and persistence. Controllers translate HTTP; services coordinate use cases; domain modules own business rules.
- **Shared** contains stable request/response contracts and primitive shared types only. Do not put database models or server business logic here.
- **Database** belongs to the API. Schema changes are migrations; application services depend on persistence interfaces where that keeps domain behavior independently testable.

Keep each feature cohesive. Prefer small modules with explicit exports over cross-importing another module's internals. Add unit tests for deterministic rules, API integration tests for persistence/authorization, and end-to-end tests for user journeys. Use fixed fixtures and avoid external services in routine checks.

## Vocabulary lists

The PostgreSQL `dictionary_words` table supplies both answers and valid guesses. `WordListRepository.dictionaryGameWords` selects entries by length, lowercase English letters, and a nonempty definition. `GameService` keeps that pool for the lifetime of each game; personal-word mode limits answers to the intersection of the personal list and the dictionary. Seed the database before starting games. The old files in `packages/shared/vocabulary` are historical snapshots and are no longer loaded by the API; retain their source notices while those files remain in the repository.

## Accounts

Registration requires a unique case-insensitive username (3–32 letters/numbers/underscores, starting with a letter) and an 8–128 character password. Email is nullable/optional; verification is opt-in (`sendVerification: true`) and does not gate access. Sign-in accepts username or a linked email. Account records and hashed session tokens are stored in PostgreSQL; passwords use Node scrypt. Browser sessions use an HttpOnly, SameSite=Lax cookie, marked Secure in production. Auth routes are throttled to ten requests per minute per IP. Recovery and verification use expiring, single-use hashed tokens; resetting a password revokes sessions. Recovery requires a previously linked email; signed-in users without one can add it using their current password. Account deletion requires the current password and `DELETE` confirmation. Its transaction removes owned games/guesses and cascades personal lists/words, sessions, and action links. Game creation locks the account row to prevent orphan games during concurrent deletion. New account-owned storage must participate in this cleanup. Configure email as described in [GAMES_AND_ACCOUNTS.md](GAMES_AND_ACCOUNTS.md). Existing accounts receive a unique generated username and retain email sign-in.

Start the local database with `docker compose up -d database` before using account endpoints. The API creates its account tables on the first auth request. Run the dictionary seed command in Local setup once to populate its search data. Auth and word-list HTTP tests use deterministic repository adapters, so endpoint contracts can be checked without Docker.

After sign-in/signup, `useAccount` invokes the browser guest-progress transfer. The authenticated `/progress/claim` route accepts 100 validated words per batch and reads guest ownership from the HttpOnly cookie. `ProgressTransferRepository` coordinates a transaction through the existing word/game repositories; game owner keys and serialized state change together. Account-bound batch receipts make retries safe, and guest claims reject stale guest game creation. Lists/words already in the account take precedence. Pending local data remains until all batches succeed and is retried on reload or through Account. See [GAMES_AND_ACCOUNTS.md](GAMES_AND_ACCOUNTS.md) for the storage and cookie limits. `account-email.ts` builds escaped HTML and plain-text messages; mail delivery uses the existing provider boundary.

## Personal vocabulary list

Personal words store a term, definition, optional part of speech, and Known/Unfamiliar status. Example sentences are no longer supported by the API or importer. Existing databases drop `user_words.example` during word-list schema setup. Dictionary schema setup and seeding drop `dictionary_words.source`; attribution remains in the license notice and `/licenses` page rather than on every dictionary row.

Every account has one overall “My words” list. `GET /api/v1/word-lists` ensures and returns that list; the first schema migration merges existing lists per owner, keeps duplicate terms once, removes list descriptions, and enforces one list per account. Word entries use `/:listId/words` for create, edit, status changes, and delete. Terms accept letters, spaces, and hyphens. Each word is `KNOWN` or `UNFAMILIAR`; new manual, imported, and dictionary words default to `UNFAMILIAR`.

The shared dictionary is seeded from Simple English Wiktionary through its public MediaWiki API. After starting PostgreSQL with `docker compose up -d database`, load or refresh it with `pnpm --filter @lexiplay/api dictionary:seed`; this replaces the shared dictionary rows atomically after a successful import. The API requires internet access while seeding. Preserve attribution and the source’s share-alike terms as described in [`SIMPLE-WIKTIONARY-LICENSE`](../apps/api/src/modules/word-lists/SIMPLE-WIKTIONARY-LICENSE). `GET /api/v1/word-lists/dictionary?q=...` searches the shared dictionary, and `POST /api/v1/word-lists/:listId/dictionary` adds an entry to the owner’s list. Gameplay uses this same database dictionary.

The importer accepts numbered parts of speech such as `Noun 1` and `Verb 2` for words with distinct meanings, including `tear`. Entries keep the first two distinct definitions and all recognized parts of speech. After updating the importer, refresh the dictionary in the intended database to recover entries skipped by an older parser; deploying the code alone does not update existing dictionary rows.

Word-list uploads support `.txt`, `.docx`, `.csv`, `.xlsx`, and text-based `.pdf` files. Preview and confirmation stay separate; PDF extraction is limited to the first 50 pages, upload size is capped at 5 MB, and each confirmed row defaults to unfamiliar. Scanned PDFs without extractable text need OCR and currently preview as empty. API and UI boundaries are in [`outputs/docs/WORD_LIST_DESIGN.md`](../outputs/docs/WORD_LIST_DESIGN.md).

## Local setup

Use Node.js 22+, the pinned pnpm 11.25.0, and Docker Desktop. Copy `.env.example` to the gitignored root `.env` for local settings. `pnpm dev` loads that file through Node’s built-in environment loader; existing shell variables take precedence. Standalone API commands still read their environment directly. Restart the launcher after changing email configuration. Never commit secrets or real user data. Run `pnpm install` from the repository root so the lockfile governs every workspace package.

Run `pnpm dev` to start the API and web development server. The dev script selects free loopback ports, sets the web origin used by development email links, and prints the browser URL. Games and accepted guesses persist in PostgreSQL; the browser remembers its latest game ID and restores it on reload. Games use 3–9 letters and Easy/Medium/Hard rules; Statistics groups completed games by the browser’s IANA timezone.

Run the regular checks with `pnpm test`, `pnpm typecheck`, and `pnpm build`. Real-database tests run when `TEST_DATABASE_URL` names a separate disposable `lexiplay_test_*` database. CI starts PostgreSQL and runs these tests automatically. Schema setup remains lazy inside repositories; separate versioned migrations are still future work.

## GitHub setup

[DEPLOYMENT.md](DEPLOYMENT.md) covers the Render demo. `http-setup.ts` validates production configuration, serves `apps/web/dist` and browser routes beside `/api/v1`, configures bounded proxy trust, and preserves API/asset 404s. Development remains loopback with Vite’s proxy. Production binds `0.0.0.0` by default and uses Render’s public URL for mail links unless explicitly overridden. The manual first-import wrapper requires a private external database URL and explicit `SEED` input; it is never run automatically on deploy.

The repository already has an `origin` remote (see the root README). Pull requests and pushes to `main` run CI, including a disposable PostgreSQL service for integration tests. Add deployment secrets only through protected GitHub Actions environments after selecting a deployment target.
