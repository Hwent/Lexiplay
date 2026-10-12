# Learn the LexiPlay codebase

This guide explains the code currently in the repository: which files define each part of the application, how its data is structured, and which technologies it uses. Start here for a code tour, then use [DEVELOPMENT.md](DEVELOPMENT.md) for development conventions.

## 1. The overall structure

LexiPlay is a vocabulary practice application in a **TypeScript monorepo**. A monorepo keeps several related packages in one Git repository. [pnpm-workspace.yaml](../pnpm-workspace.yaml) discovers packages under `apps/*` and `packages/*`; the root [package.json](../package.json) defines commands that run across them.

```text
LexiPlay/
├── apps/
│   ├── web/                 Browser application
│   │   └── src/             React components, styles, cache, and UI tests
│   └── api/                 HTTP server
│       └── src/modules/
│           ├── accounts/    Registration, login, sessions, and account storage
│           ├── games/       Practice games, guesses, scoring, and hints
│           ├── health/      Basic server health endpoint
│           └── word-lists/  Personal vocabulary, dictionary, and file imports
├── packages/shared/        Small shared type definitions and historical word files
├── scripts/dev.mjs         Local development launcher
├── docs/                   Code learning and development documentation
├── outputs/docs/           Product requirements and design documents
├── .github/workflows/      Automated GitHub checks
├── docker-compose.yml      Local PostgreSQL service
├── pnpm-lock.yaml          Locked dependency resolution
└── tsconfig.base.json      Shared TypeScript compiler rules
```

The API is a **modular monolith**: one server composed of feature modules. The browser and server are separate applications communicating through HTTP and JSON.

```mermaid
flowchart LR
    Browser[React browser app] -->|fetch /api/v1| Proxy[Vite development proxy]
    Proxy --> API[NestJS API]
    API --> Accounts[Accounts module]
    API --> Lists[Word lists module]
    API --> Games[Games module]
    Accounts --> DB[(PostgreSQL)]
    Lists --> DB
    Games -->|dictionary and personal words| Lists
    Games --> Memory[In-memory game Map]
    Seed[Dictionary seed script] -->|MediaWiki API| Wiki[Simple English Wiktionary]
    Seed --> DB
```

Vite's proxy is part of local development. The repository does not yet define a production hosting arrangement.

## 2. Technologies and where they are configured

The versions below come from the checked-in manifests, rather than claims about the latest releases.

| Technology | Purpose in LexiPlay | Configuration or example |
| --- | --- | --- |
| Node.js 22+ | Runs development tools, the API, and the seeder. | Root [package.json](../package.json); CI uses Node 22. |
| pnpm 11.25.0 | Installs dependencies and runs workspace scripts. | Root `packageManager`, [pnpm-workspace.yaml](../pnpm-workspace.yaml), and `pnpm-lock.yaml`. |
| TypeScript 5.9.3 | Adds static types to browser and server code. | [tsconfig.base.json](../tsconfig.base.json) enables strict checks; each package extends it. |
| React / React DOM 19.3.0 | Renders browser components and manages UI state with hooks. | [apps/web/package.json](../apps/web/package.json), `main.tsx`, and `App.tsx`. |
| Vite 8.3.0 | Serves the browser app during development and builds production web assets. | [vite.config.ts](../apps/web/vite.config.ts), including the `/api` proxy. |
| CSS and browser APIs | Layout, themes, navigation, storage, and HTTP requests. | `styles.css`, History API, `localStorage`, and `fetch`; navigation is implemented in `App.tsx`. |
| NestJS 11.1.6 with Express | Organizes the API into modules, controllers, and injected services. | [apps/api/package.json](../apps/api/package.json), `main.ts`, and `app.module.ts`. |
| class-validator / class-transformer | Describe DTO input rules and transform nested request objects. | API `*.dto.ts` files and the global `ValidationPipe` in `main.ts`. |
| @nestjs/throttler | Limits requests through guards on account and word-list controllers. | `accounts.module.ts`, `word-lists.module.ts`, and their controllers. |
| PostgreSQL 17 / pg | Persists accounts, sessions, personal lists, and the dictionary using SQL. | [docker-compose.yml](../docker-compose.yml); API repository classes use `pg.Pool`. |
| Node crypto | Password derivation, session-token hashing, UUIDs, and random answer selection. | `account.service.ts` and `game.service.ts`. |
| mammoth / SheetJS xlsx / pdf-parse | Extracts words from DOCX, XLSX, and text-based PDF uploads. | `word-list-import.ts`; TXT and CSV parsing are implemented there directly. |
| tsx | Runs and watches API TypeScript without a separate development compilation step. | API `dev` and `dictionary:seed` scripts. |
| Vitest 5.0.0 | Runs API and browser tests. | Package `test` scripts and colocated `*.test.ts` / `*.test.tsx` files. |
| Testing Library / jsdom | Exercises rendered React components in a simulated browser DOM. | Web test dependencies, `vite.config.ts`, and `test-setup.ts`. |
| Docker Compose / GitHub Actions | Starts local PostgreSQL and runs automated repository checks. | `docker-compose.yml` and [.github/workflows/ci.yml](../.github/workflows/ci.yml). |

The current API uses SQL through `pg`, with no Prisma dependency or Prisma schema. The initial [technical design](../outputs/docs/TECHNICAL_DESIGN.md) proposes Prisma, persisted game history, and other future features; read it as design intent rather than a description of every implemented file.

## 3. Browser code: what each file owns

Paths in this table are relative to `apps/web/`.

| File | Responsibility and useful code to read |
| --- | --- |
| [index.html](../apps/web/index.html) | HTML entry document with the root element and script entry. |
| [src/main.tsx](../apps/web/src/main.tsx) | Finds `#root`, calls React's `createRoot`, renders `App` inside `StrictMode`, and imports styles. |
| [src/App.tsx](../apps/web/src/App.tsx) | Application shell, section navigation, theme, game options, board, keyboard, hints, and game definitions. Read `sectionPaths`, `navigateTo`, `startPractice`, `submitGuess`, and `useHint`. It imports `apiRequest` as `api` for game and related list requests. |
| [src/AccountPage.tsx](../apps/web/src/AccountPage.tsx) | Dedicated responsive `/account` page for signup with optional email/verification, sign-in/out, adding recovery email, password recovery, and confirmed deletion. Makes requests to `/api/v1/auth/*`; `account.css` styles the page. |
| [src/PasswordField.tsx](../apps/web/src/PasswordField.tsx) | Shared password input with accessible Show/Hide controls, autocomplete, and automatic hiding when cleared. |
| [src/AccountStatus.tsx](../apps/web/src/AccountStatus.tsx) / [src/useAccount.ts](../apps/web/src/useAccount.ts) | Compact header status and a shared account/session lookup that stays mounted across page changes. |
| [src/GameCatalog.tsx](../apps/web/src/GameCatalog.tsx) | Catalogue of available games, currently Word puzzle; the entry point for future game views. |
| [src/StatisticsPanel.tsx](../apps/web/src/StatisticsPanel.tsx) | Completed-game metrics, winning guess distribution, recent practice, and guest/error/empty states. |
| [src/WordListsPanel.tsx](../apps/web/src/WordListsPanel.tsx) | Personal list display, search, pagination, manual edits, Known/Unfamiliar toggles, dictionary saves, and upload preview/confirmation. It imports `apiRequest` as `request`; read `loadLocalLists`, the pending operation maps, and the route-change effect. |
| [src/services/api-client.ts](../apps/web/src/services/api-client.ts) | Shared browser HTTP boundary. `apiRequest<T>` prefixes `/api/v1`, includes same-origin session credentials, handles JSON and multipart requests, accepts 204 responses, and throws an `ApiError` carrying HTTP status. |
| [src/dictionary-cache.ts](../apps/web/src/dictionary-cache.ts) | Normalizes dictionary terms, caches search results and canonical definitions, persists them to browser storage, and shares simultaneous requests. Read `searchDictionary`, `dictionaryDefinition`, and `rememberDictionaryDefinition`. |
| [src/styles.css](../apps/web/src/styles.css) | Layout, responsive styling, component appearance, and light/dark theme rules. |
| [src/test-setup.ts](../apps/web/src/test-setup.ts) | Shared browser-test setup. |
| [vite.config.ts](../apps/web/vite.config.ts) | React plugin, local API forwarding, and Vitest's jsdom environment. |

React `useState` holds values that affect rendering, such as the current guess or list contents. `useEffect` coordinates side effects such as loading data and attaching browser events. `useRef` holds mutable values such as input references and pending operations without causing a render by itself.

The supplied [React standard](react-standard.md) is a scaffolding template. Keep PascalCase component files with default exports, named utility exports, colocated tests, immutable state updates, cleaned-up effects, semantic controls, and explicit loading/error states. The current app uses TypeScript, History API navigation, and shared stylesheets; it does not implement the template's exact JavaScript folder tree, React Router, or CSS Modules.

`App`, `AccountPage`, `useAccount`, `WordListsPanel`, and `dictionary-cache` use `services/api-client.ts` for HTTP requests. Feature code owns response types, caching, guest behavior, and user messages. The generic `T` describes the expected JSON shape at compile time; it does not validate server responses at runtime. `ApiError` here is a browser error class, distinct from the API error payload type in `packages/shared`.

There is no routing library: `App.tsx` maps paths such as `/games`, `/library`, and `/licenses` to sections, calls `history.pushState`, and listens for `popstate`. `/play` remains a compatible games URL. Changing sections dispatches `lexiplay:before-route-change`. For signed-in users, `WordListsPanel.tsx` uses that event to flush queued word edits and status changes. Imports use a separate confirmation request. Guest list changes are stored on the device.

The dictionary cache lasts 24 hours and keeps up to 100 searches and 300 definitions. It uses memory if browser storage fails. Personal definitions are separate from cached canonical dictionary definitions.

## 4. API code: modules, controllers, services, repositories, and DTOs

| Layer | What it defines | Example |
| --- | --- | --- |
| Entry point | Server creation and global HTTP configuration. | [main.ts](../apps/api/src/main.ts) sets `/api/v1`, validation, and the loopback listening address. |
| Root module | Which feature modules make up the application. | [app.module.ts](../apps/api/src/app.module.ts) imports Health, Games, Accounts, and WordLists. |
| Feature module | Controllers, providers, imports, and exports for a feature. | [word-lists.module.ts](../apps/api/src/modules/word-lists/word-lists.module.ts) imports Accounts and exports `WordListsService`. |
| Controller | HTTP routes and translation between requests and service calls. | `@Post`, `@Get`, `@Body`, and `@Param` in controller files. |
| Service | Application behavior, rules, and coordination. | `GameService` scores guesses; `WordListsService` checks the current user and normalizes words. |
| Repository | SQL queries and persistence details. | `AccountRepository` and `WordListRepository` own PostgreSQL pools and schema setup. |
| DTO | Expected request fields and validation rules. | `AccountCredentialsDto`, `SaveWordDto`, and `ConfirmWordImportDto`. |

NestJS dependency injection supplies objects to constructors through registered providers and `@Inject`. Feature modules export services when another module needs their behavior: Games imports WordLists, and WordLists imports Accounts.

### Accounts

Files under [apps/api/src/modules/accounts](../apps/api/src/modules/accounts):

- `account.controller.ts` defines signup, sign-in/out, current account, recovery/verification, adding recovery email, and deletion routes; it sets or clears the session cookie.
- `account.service.ts` normalizes optional emails, derives password hashes with scrypt, verifies passwords, creates 14-day sessions, and hashes session tokens with SHA-256 before storage. Email verification is opt-in. Adding email and deleting an account require the current password.
- `account.repository.ts` defines `AccountUser` / `AccountRecord` and queries account tables. Email is nullable. Account deletion locks the user and atomically removes owned games plus the user; foreign keys cascade personal words/lists, sessions, and action links. Game creation takes a compatible account lock to avoid orphan games during deletion.
- `account.dto.ts` validates usernames, email addresses, action tokens, and 8–128 character passwords.
- `account-mail.service.ts` delivers verification/reset links through local development previews or the configured Resend API. `account_actions` stores expiring token hashes, consumed once in a transaction.
- `session-cookie.ts` extracts and validates the `lexiplay_session` token from the request cookie header.
- `accounts.module.ts` registers providers, exports `AccountService`, and configures account throttling.

The browser receives an HttpOnly, SameSite=Lax cookie scoped to `/api/v1`; `Secure` is added when `NODE_ENV` is `production`. Raw session tokens are not stored in PostgreSQL.

### Games

Files under [apps/api/src/modules/games](../apps/api/src/modules/games):

- `game.controller.ts` handles start, restore, guesses, and hints, resolves account/guest ownership, and validates requests.
- `game.service.ts` selects answers, checks guesses, scores duplicate letters, enriches definitions, and coordinates persisted hints/completion.
- `game.types.ts` defines game state, public answer redaction, and difficulty rules. `game.dto.ts` and `submit-guess.dto.ts` validate 3–9 letters and allowed settings.
- `game.repository.ts` stores games and guesses in PostgreSQL, with transactions and row locks for updates.
- `statistics.controller.ts` returns authenticated completed-game metrics and timezone-aware practice streaks.
- `games.module.ts` registers these controllers/providers and imports WordLists and Accounts.

Games support 3–9 letters. Easy allows seven guesses and three uses of each hint; Medium allows six and two; Hard allows five and one. `CORRECT` means the right letter in the right position, `PRESENT` means an available matching letter elsewhere, and `ABSENT` means no remaining matching occurrence. Exact matches are counted first so repeated letters are not credited more times than they occur in the answer.

Each game persists its allowed dictionary words at start. Personal-word mode restricts **answers** to saved terms in that dictionary pool; guesses can still use the full pool. Both Known and Unfamiliar personal words are eligible. Remove letters reveals up to three absent letters per use; Reveal a letter reveals an answer letter without its position. See [GAMES_AND_ACCOUNTS.md](GAMES_AND_ACCOUNTS.md) for the complete current behavior.

### Personal vocabulary and dictionary

Files under [apps/api/src/modules/word-lists](../apps/api/src/modules/word-lists):

| File | What it defines |
| --- | --- |
| `word-lists.controller.ts` | List retrieval, word create/update/delete, public dictionary search/definition routes, dictionary saves, and multipart import preview/JSON confirmation. |
| `word-lists.service.ts` | Current-user checks, term normalization, duplicate handling, personal game words, dictionary access, and import coordination. |
| `word-list.repository.ts` | `WordEntry`, `WordList`, `DictionaryEntry`, PostgreSQL queries, owner constraints, one-list-per-account setup, and dictionary game-word selection. |
| `word-list.dto.ts` | Manual word, update, dictionary-add, and selected import-row request structures. |
| `word-list-import.ts` | `ImportPreviewRow`, issue codes, file parsers, duplicate detection, and upload/container limits. |
| `seed-simple-wiktionary.ts` | Standalone importer that fetches MediaWiki revisions, stages entries, checks the result, and replaces dictionary rows in a transaction. |
| `wiktionary-definition.ts` | Wikitext-to-plain-text extraction of up to two definition senses and parts of speech. |
| `wiktionary-pagination.ts` | Replaces previous MediaWiki continuation parameters with those from the latest response. |
| `SIMPLE-WIKTIONARY-LICENSE` | Attribution and source license information. |
| `word-lists.module.ts` | Registers the feature's dependencies and exposes `WordListsService` to Games. |

Import preview supports TXT, DOCX, CSV, XLSX, and text-based PDF. Limits include 5 MB per file, 1,000 rows, and the first 50 PDF pages. Preview returns normalized rows, issues, selection flags, and totals; it does not save words. Confirmation writes selected rows, skipping existing terms. Guest preview also calls the API, but guest confirmation stores words locally. See [WORD_LIST_DESIGN.md](../outputs/docs/WORD_LIST_DESIGN.md) for the fuller route and import description.

The dictionary seed fetches data only when explicitly run. Ordinary search and gameplay read PostgreSQL. Its staging transaction preserves the previous dictionary if import fails or required checks fail, including the check for `because`.

## 5. Data structures and where they live

### Persistent data: PostgreSQL

The schema is currently defined inside the repository classes and seeder, not in a standalone migration directory. Account schema creation is lazy on repository access. Word-list schema setup also performs alterations and merges older lists so an owner has one overall list.

| Table | Main fields and relationship | Defining code |
| --- | --- | --- |
| `account_users` | UUID `id`, unique nullable email, unique username, optional verification flag, password hash, creation timestamp. | `AccountRepository.ensureSchema`. |
| `account_sessions` | Token hash primary key, user ID, expiry and creation timestamps; belongs to an account. | `AccountRepository.ensureSchema`. |
| `account_actions` | One-use reset/verification token hashes, owner, purpose, and expiry. | `AccountRepository.ensureSchema`. |
| `practice_games` | UUID `id`, account/hashed-guest owner key, server-only state JSON. | `GameRepository.ensureSchema`. |
| `practice_guesses` | Game ID, position, accepted result JSON including learning definitions. | `GameRepository.ensureSchema`. |
| `user_word_lists` | UUID `id`, owner ID, name, timestamps; unique owner, with the name `My words`. | `WordListRepository.ensureSchema` and `ensureDefaultList`. |
| `user_words` | UUID `id`, list ID, term, definition, optional part of speech, status, timestamps; unique `(list_id, term)`. | `WordListRepository.ensureSchema`. |
| `dictionary_words` | Term primary key, canonical definition, parts-of-speech array. Shared across users. | `WordListRepository.ensureDictionarySchema` and the seed script. |

Personal terms accept letters, spaces, apostrophes, and hyphens, up to 100 characters, and are normalized to lowercase. Definitions are limited to 500 characters in personal entries. `WordStatus` is the union `'KNOWN' | 'UNFAMILIAR'`, with new words defaulting to `UNFAMILIAR`. Game words have narrower requirements: only `a`–`z`, the selected length, and a nonempty canonical definition.

The server's `WordList` response has `{ id, name, words }`; each `WordEntry` has `{ id, term, definition, partOfSpeech, status }`. Repository queries map SQL names such as `part_of_speech` to JSON names such as `partOfSpeech`.

### Transient and browser data

| Location | Structure | Lifetime |
| --- | --- | --- |
| `localStorage`: `lexiplay-last-game` | Latest game ID; no answer or server-only state. | Used to restore the owned game across reloads; cleared on account changes or choosing a new puzzle. |
| React component state | Current section, guess, game response, list contents, messages, and UI controls. | Component/page lifetime. |
| `WordListsPanel` refs | Maps of pending word operations and status changes. | Component lifetime, flushed on the app's route-change event. |
| `localStorage`: `lexiplay-theme` | Light/dark preference. | Across browser reloads on that origin. |
| `localStorage`: `lexiplay-local-word-lists` | Guest personal list and words. | On that browser origin; no implemented account synchronization. |
| `localStorage`: `lexiplay-dictionary-cache-v1` | Cached search/definition entries with `expiresAt`; also held in in-memory maps. | 24-hour cache entries. |

[packages/shared/src/index.ts](../packages/shared/src/index.ts) currently exports only `ApiError` and `HealthStatus` types. Most game/account/list response types are defined locally in the web and API files, rather than imported from a generated shared client. The files in [packages/shared/vocabulary](../packages/shared/vocabulary/README.md) are historical SCOWL word-list snapshots; the current API does not load them for games.

## 6. Trace a feature through the code

### Starting and playing a game

1. `App.startPractice` posts `{ kind, wordLength, difficulty, playWithMyWords }` to `/api/v1/games`.
2. Vite forwards the request to the local API. `GameController.start` obtains authenticated personal words if that mode is selected.
3. `GameService.start` obtains valid dictionary terms, chooses an answer, and persists the owned game. The initial response does not include the answer.
4. `App.submitGuess` posts a guess using the returned ID. `GameService.submit` validates/scores it and stores learning definitions and completion state in one transaction.
5. React renders feedback; completion includes the answer and definition. Reload uses `GET /games/:id` to restore the saved board and hints. Statistics reads completed games for the signed-in owner.

### Saving a personal word

1. `WordListsPanel` loads `/word-lists`. The API checks the session and ensures the account's single list exists. A 401 response puts the panel into guest/local mode.
2. Adding or editing a word updates the UI. For a signed-in user, the panel queues that operation in a ref map.
3. An app route change dispatches `lexiplay:before-route-change`; the panel sends queued create/update/delete requests and status changes.
4. `WordListsService` resolves the current account, normalizes the input, and delegates to owner-scoped repository queries. Guest changes instead persist to `localStorage`.

This flow explains why seeing a change in the signed-in list UI does not by itself mean it has already been written to PostgreSQL.

## 7. Run the project and understand the checks

Use Node.js 22+, the pinned pnpm 11.25.0, and Docker for the local database. Run these commands from the repository root:

```powershell
pnpm install
docker compose up -d database
pnpm --filter @lexiplay/api dictionary:seed
pnpm dev
```

The seed command needs internet access and loads or refreshes the local dictionary. [scripts/dev.mjs](../scripts/dev.mjs) starts the API with `PORT=0`, reads its actual address, and passes that address to Vite as `API_ORIGIN`. Both servers use available loopback ports; open the printed web URL. PostgreSQL persists through the named Docker volume.

The API reads `process.env`. `pnpm dev` loads the gitignored root `.env` through Node’s built-in loader before starting the servers; existing shell values win. [.env.example](../.env.example) documents settings. The launcher supplies `PUBLIC_WEB_ORIGIN` using its actual web port unless explicitly overridden. `WEB_ORIGIN` remains a placeholder; browser API requests use the Vite proxy. Email links target `/account`; older root-page action links still route to Account.

```powershell
pnpm test
pnpm typecheck
pnpm build
```

| Check or test file | What it verifies |
| --- | --- |
| `pnpm test` | Runs existing Vitest suites in web and API; shared has no test script. |
| `pnpm typecheck` | Checks each workspace's TypeScript without emitting output. |
| `pnpm build` | Builds shared declarations/JavaScript, API JavaScript, and Vite web assets into package `dist` directories. |
| [App.test.tsx](../apps/web/src/App.test.tsx) | Practice interaction, account UI, navigation, attribution, and play options with mocked API responses. |
| [WordListsPanel.test.tsx](../apps/web/src/WordListsPanel.test.tsx) | Queued changes, dictionary saves, duplicate prevention, guest persistence, pagination, and imports. |
| [dictionary-cache.test.ts](../apps/web/src/dictionary-cache.test.ts) | Shared requests, persistence, expiry, retries, and storage-failure fallback. |
| [health.e2e.test.ts](../apps/api/src/health.e2e.test.ts) | Health HTTP route, dictionary-backed games, personal answer pools, hints, and completion. |
| [accounts.e2e.test.ts](../apps/api/src/modules/accounts/accounts.e2e.test.ts) | Registration, identification, logout, and login through HTTP/session cookies. |
| [word-lists.e2e.test.ts](../apps/api/src/modules/word-lists/word-lists.e2e.test.ts) | Ownership, dictionary access, status changes, and import preview/confirmation through HTTP. |
| `wiktionary-definition.test.ts` / `wiktionary-pagination.test.ts` | Definition extraction and continuation parameter replacement. |

Most API HTTP tests use deterministic repository substitutes or spies. `persistence.e2e.test.ts` runs against real PostgreSQL when `TEST_DATABASE_URL` points at a disposable `lexiplay_test_*` database; it covers restart, concurrency, ownership, Statistics, account links, adding recovery email, and account deletion with cleanup/isolation. Browser tests use jsdom and mocked fetch, including signup without email, opt-in verification, password visibility, recovery, and deletion confirmation. GitHub [CI](../.github/workflows/ci.yml) supplies a PostgreSQL service, installs the frozen lockfile, then runs tests, typechecking, and builds. Live Wiktionary import and actual email delivery are not part of automated checks.

## 8. Current limits to keep in mind while learning

- Community remains a placeholder. Games and guesses now persist, and Statistics is implemented; a missed-word review queue is still future work.
- Guest lists remain on the browser origin. Personal-word games require an authenticated API list; they do not read the guest list from browser storage. Changing the local web port also changes the browser storage origin.
- Signed-in manual list edits are queued until app navigation. The current code does not implement a durable pending-operation queue or a page-close save flow.
- Automatic puzzle resume needs the browser’s saved game ID and its ownership cookie/session. Guest games do not transfer into accounts. Production email requires provider/sender/origin configuration; development uses local previews.
- Schema changes currently run inside lazy repository setup. The migration approach described in the development/design docs is a convention to move toward, not a separate implemented migration system.
- PDF import extracts text and does not perform OCR. The health endpoint returns `{ status: 'ok' }` without checking database readiness.

## 9. Suggested reading order

1. Read this guide's structure and technology tables, then the root `package.json` and `scripts/dev.mjs`.
2. Follow `main.tsx` into `App.tsx` and trace a game request into API `main.ts`, `app.module.ts`, `game.controller.ts`, and `game.service.ts`.
3. Read the account controller, service, repository, and cookie helper to understand authentication.
4. Follow `WordListsPanel.tsx` into the word-list controller, service, repository, DTOs, and import parser.
5. Read `dictionary-cache.ts`, the Wiktionary seed helpers, and their tests to understand caching and dictionary ingestion.
6. Use [DEVELOPMENT.md](DEVELOPMENT.md) for conventions, [GAMES_AND_ACCOUNTS.md](GAMES_AND_ACCOUNTS.md) for current gameplay/account behavior, [WORD_LIST_DESIGN.md](../outputs/docs/WORD_LIST_DESIGN.md) for list behavior, and [dictionary-source-review.md](dictionary-source-review.md) for the dictionary-source decision. Consult [PRD.md](../outputs/docs/PRD.md) and [TECHNICAL_DESIGN.md](../outputs/docs/TECHNICAL_DESIGN.md) for broader product/design intent.
