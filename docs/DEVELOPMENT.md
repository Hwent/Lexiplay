# Development guide

## Component boundaries

- **Web** owns presentation, navigation, accessibility, and transient input state. It calls the API through a typed client/contract boundary.
- **API** owns authentication, authorization, validation, puzzle rules, and persistence. Controllers translate HTTP; services coordinate use cases; domain modules own business rules.
- **Shared** contains stable request/response contracts and primitive shared types only. Do not put database models or server business logic here.
- **Database** belongs to the API. Schema changes are migrations; application services depend on persistence interfaces where that keeps domain behavior independently testable.

Keep each feature cohesive. Prefer small modules with explicit exports over cross-importing another module's internals. Add unit tests for deterministic rules, API integration tests for persistence/authorization, and end-to-end tests for user journeys. Use fixed fixtures and avoid external services in routine checks.

## Vocabulary lists

Guess and answer words are stored separately by length in `packages/shared/vocabulary`. The API validates each guess against the matching length bucket and chooses answers only from the answer bucket. Keep the source snapshot and required notices with any list update; see `packages/shared/vocabulary/README.md` before redistributing the five-letter guess list.

## Accounts

The API provides `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, and `GET /api/v1/auth/me`. Account records and hashed session tokens are stored in PostgreSQL; passwords are derived with Node's scrypt implementation. Browser sessions use an HttpOnly, SameSite=Lax cookie, marked Secure in production. Auth routes are throttled to ten requests per minute per IP. The account panel supports registration, sign-in, and sign-out; account recovery and email verification are the next account milestone.

Start the local database with `docker compose up -d database` before using account endpoints. The API creates its account tables on the first auth request. Run the dictionary seed command in Local setup once to populate its search data. Auth and word-list HTTP tests use deterministic repository adapters, so endpoint contracts can be checked without Docker.

## Personal vocabulary list

Every account has one overall “My words” list. `GET /api/v1/word-lists` ensures and returns that list; the first schema migration merges existing lists per owner, keeps duplicate terms once, removes list descriptions, and enforces one list per account. Word entries use `/:listId/words` for create, edit, status changes, and delete. Terms accept letters, spaces, and hyphens. Each word is `KNOWN` or `UNFAMILIAR`; new manual, imported, and dictionary words default to `UNFAMILIAR`.

The WordNet 3.1 dictionary is downloaded through the pinned `wordnet-db@3.1.12` package. After starting PostgreSQL with `docker compose up -d database`, load or update its rows with `pnpm --filter @lexiplay/api dictionary:seed`. Preserve the Princeton notice in [`WORDNET-LICENSE`](../apps/api/src/modules/word-lists/WORDNET-LICENSE). `GET /api/v1/word-lists/dictionary?q=...` searches the shared dictionary, and `POST /api/v1/word-lists/:listId/dictionary` adds an entry to the owner’s list.

Word-list uploads support `.txt`, `.docx`, `.csv`, `.xlsx`, and text-based `.pdf` files. Preview and confirmation stay separate; PDF extraction is limited to the first 50 pages, upload size is capped at 5 MB, and each confirmed row defaults to unfamiliar. Scanned PDFs without extractable text need OCR and currently preview as empty. API and UI boundaries are in [`outputs/docs/WORD_LIST_DESIGN.md`](../outputs/docs/WORD_LIST_DESIGN.md).

## Local setup

Use Node.js 22+, pnpm 10+, and Docker Desktop. Copy `.env.example` to `.env` when service configuration is introduced. Never commit secrets or real user data. Run `pnpm install` from the repository root so the lockfile governs every workspace package.

Run `pnpm dev` to start the API and web development server. The dev script selects free loopback ports and prints the browser URL, which also works in environments that reserve common fixed development ports. Active practice games are held in API memory, so restarting the API clears them.

## GitHub setup

Create an empty GitHub repository, then add it as `origin` and push `main` (commands are in the root README). Configure pull requests to run the repository checks before merging. Add deployment secrets only through GitHub Actions environments after a deployment target is selected.
