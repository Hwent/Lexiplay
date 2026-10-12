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

Registration requires email, a unique case-insensitive username (3–32 letters/numbers/underscores, starting with a letter), and an 8–128 character password. Sign-in accepts username or email. Account records and hashed session tokens are stored in PostgreSQL; passwords use Node scrypt. Browser sessions use an HttpOnly, SameSite=Lax cookie, marked Secure in production. Auth routes are throttled to ten requests per minute per IP. Recovery and verification use expiring, single-use hashed tokens; resetting a password revokes sessions. Configure email as described in [GAMES_AND_ACCOUNTS.md](GAMES_AND_ACCOUNTS.md). Existing accounts receive a unique generated username and retain email sign-in.

Start the local database with `docker compose up -d database` before using account endpoints. The API creates its account tables on the first auth request. Run the dictionary seed command in Local setup once to populate its search data. Auth and word-list HTTP tests use deterministic repository adapters, so endpoint contracts can be checked without Docker.

## Personal vocabulary list

Personal words store a term, definition, optional part of speech, and Known/Unfamiliar status. Example sentences are no longer supported by the API or importer. Existing databases drop `user_words.example` during word-list schema setup. Dictionary schema setup and seeding drop `dictionary_words.source`; attribution remains in the license notice and `/licenses` page rather than on every dictionary row.

Every account has one overall “My words” list. `GET /api/v1/word-lists` ensures and returns that list; the first schema migration merges existing lists per owner, keeps duplicate terms once, removes list descriptions, and enforces one list per account. Word entries use `/:listId/words` for create, edit, status changes, and delete. Terms accept letters, spaces, and hyphens. Each word is `KNOWN` or `UNFAMILIAR`; new manual, imported, and dictionary words default to `UNFAMILIAR`.

The shared dictionary is seeded from Simple English Wiktionary through its public MediaWiki API. After starting PostgreSQL with `docker compose up -d database`, load or refresh it with `pnpm --filter @lexiplay/api dictionary:seed`; this replaces the shared dictionary rows atomically after a successful import. The API requires internet access while seeding. Preserve attribution and the source’s share-alike terms as described in [`SIMPLE-WIKTIONARY-LICENSE`](../apps/api/src/modules/word-lists/SIMPLE-WIKTIONARY-LICENSE). `GET /api/v1/word-lists/dictionary?q=...` searches the shared dictionary, and `POST /api/v1/word-lists/:listId/dictionary` adds an entry to the owner’s list. Gameplay uses this same database dictionary.

Word-list uploads support `.txt`, `.docx`, `.csv`, `.xlsx`, and text-based `.pdf` files. Preview and confirmation stay separate; PDF extraction is limited to the first 50 pages, upload size is capped at 5 MB, and each confirmed row defaults to unfamiliar. Scanned PDFs without extractable text need OCR and currently preview as empty. API and UI boundaries are in [`outputs/docs/WORD_LIST_DESIGN.md`](../outputs/docs/WORD_LIST_DESIGN.md).

## Local setup

Use Node.js 22+, the pinned pnpm 11.25.0, and Docker Desktop. `.env.example` documents sample settings; the current launcher and API read `process.env` and do not automatically load `.env`. Set custom values such as `DATABASE_URL` in the shell before running commands. Never commit secrets or real user data. Run `pnpm install` from the repository root so the lockfile governs every workspace package.

Run `pnpm dev` to start the API and web development server. The dev script selects free loopback ports, sets the web origin used by development email links, and prints the browser URL. Games and accepted guesses persist in PostgreSQL; the browser remembers its latest game ID and restores it on reload. Games use 3–9 letters and Easy/Medium/Hard rules; Statistics groups completed games by the browser’s IANA timezone.

Run the regular checks with `pnpm test`, `pnpm typecheck`, and `pnpm build`. Real-database tests run when `TEST_DATABASE_URL` names a separate disposable `lexiplay_test_*` database. CI starts PostgreSQL and runs these tests automatically. Schema setup remains lazy inside repositories; separate versioned migrations are still future work.

## GitHub setup

The repository already has an `origin` remote (see the root README). Pull requests and pushes to `main` run CI, including a disposable PostgreSQL service for integration tests. Add deployment secrets only through protected GitHub Actions environments after selecting a deployment target.
