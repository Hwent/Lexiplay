# LexiPlay — Technical Design

**Status:** Design intent with current implementation notes · **Version:** 0.2

The implementation preserves React + NestJS + PostgreSQL and uses the existing `pg` driver rather than Prisma. Schema setup remains lazy in repositories; standalone migration tooling and container deployment remain planned. See [GAMES_AND_ACCOUNTS.md](../../docs/GAMES_AND_ACCOUNTS.md) for current APIs, storage, email configuration, Statistics semantics, and limits. The logical entities below include future review/deployment work and are not a literal schema listing.

## 1. Architecture

Use a TypeScript monorepo with a responsive React frontend and a NestJS REST API. The API owns authentication, authorization, puzzle rules, vocabulary validation, and persistence. PostgreSQL is the source of truth; current repositories use `pg`. Introduce separate versioned migrations without rewriting unrelated modules when deployment work begins.

```text
Browser (React + TypeScript)
        │ HTTPS / JSON REST (/api/v1)
        ▼
NestJS modules ── pg repositories ── PostgreSQL
        │
        └── structured logs / health endpoints

GitHub Actions → lint, typecheck, test, build → container image → hosting platform
```

Suggested modules: `Auth`, `Users`, `WordLists`, `Words`, `Games`, `Progress`, and `Health`. Keep domain rules in services rather than controllers. Start as a modular monolith; do not introduce microservices or a queue before a demonstrated need.

## 2. Suggested repository layout

```text
apps/web/                 React client
apps/api/                 NestJS application
packages/shared/          shared DTO/client types only, not domain persistence
apps/api/prisma/          schema and migrations
docs/                     product and technical documentation
docker-compose.yml        local PostgreSQL and app dependencies
```

Choose a workspace/package manager and pin its version. Keep API and web deployable independently while sharing one repository and CI pipeline.

## 3. Authentication and security

- Use a maintained authentication library or a carefully reviewed NestJS integration; prefer secure, HttpOnly, Secure, SameSite cookies for browser sessions. Avoid storing long-lived bearer tokens in local storage.
- Current passwords use scrypt and allow 8–128 characters; usernames are unique/case-insensitive. Email is nullable and verification opt-in, with no access gate. Users without email can add a recovery address by confirming their current password. Generic auth/recovery errors, throttling, single-use expiring verification/reset tokens, and session revocation on reset are implemented. Recovery needs a previously linked email. Real email delivery requires configured Resend credentials and sender; development uses local previews.
- Validate all inputs with DTO validation (allow-list properties, reject unknown fields); enforce ownership checks on every list, word, game, and progress operation.
- Configure CORS for explicit origins, TLS in production, security headers, CSRF protections appropriate to cookie auth, request/body limits, and throttling on auth/import/game-start routes.
- Store secrets in the hosting platform's secret manager. Never log passwords, session tokens, imported file contents, or full guess histories.
- Account deletion requires an authenticated session, current password, and `DELETE` confirmation. One transaction deletes owned games/guesses and the account, cascading personal lists/words, sessions, and action links. Game creation locks the user row against deletion. Add privacy policy, retention rules, account export, and backup access controls before public release.

## 4. PostgreSQL data model

Current tables are `account_users`, `account_sessions`, `account_actions`, `user_word_lists`, `user_words`, `dictionary_words`, `practice_games`, and `practice_guesses`. Games store their kind/rules and protected state as JSONB; guesses have ordered JSONB results including definitions. Game updates and accepted guesses share a transaction and row lock. Read transactions use a consistent snapshot. Signed-in owner keys identify an account; guest owner keys contain only a hash of the opaque cookie. Active-game response projection excludes the answer, allowed-word pool, and owner key. Statistics computes completed-game metrics and local-calendar-day streaks from UTC timestamps.

Use UUID primary keys, UTC timestamps, foreign keys, and indexes for common owner/date queries. The following remains the broader logical model, including future review capabilities.

`guest_progress_claims` and `progress_transfers` also belong to accounts through cascading foreign keys. The authenticated progress-claim transaction merges browser words and moves cookie-owned games, updating both owner keys and serialized owner fields. Existing words remain authoritative. Advisory locks serialize batch retries and guest ownership transitions; receipts bind IDs/payload hashes to accounts. Pending snapshots stay in browser storage until all batches are acknowledged. Account emails use escaped HTML with plain-text alternatives and explicit expiry/optionality.

| Entity | Key fields and relationships |
|---|---|
| `User` | `id`, unique normalized `email`, `passwordHash` or external auth identity, `createdAt`; owns lists and games. Keep profile fields minimal. |
| `WordList` | `id`, `ownerId` nullable for system lists, `name`, `description`, `visibility` (`PRIVATE`/`SYSTEM`), `source`, timestamps; index owner/name. |
| `Word` | `id`, `listId`, normalized `term`, `definition`, nullable `partOfSpeech`, `language`, `isPlayable`, timestamps; unique `(listId, term)`, index `(listId, isPlayable)`. |
| `Game` | `id`, `userId` nullable for guest preview, `listId`, `status`, `answerWordId` nullable plus `answerSnapshot`, `attemptLimit`, `startedAt`, nullable `completedAt`, `outcome`; index `(userId, startedAt)`. Protect answer fields from ordinary read DTOs. |
| `Guess` | `id`, `gameId`, `position`, normalized `term`, `feedback` JSON or per-letter rows, `createdAt`; unique `(gameId, position)`. Persist only accepted guesses. |
| `ReviewItem` | `id`, `userId`, `wordId`, `sourceGameId`, `dueAt`, nullable `lastReviewedAt`, `reviewCount`; unique `(userId, wordId)` for MVP, index `(userId, dueAt)`. |
| `Session` (if app-managed) | hashed session token, `userId`, expiration and revocation timestamps; never persist raw token. |

Store an answer snapshot (term and learning metadata) on game completion or at start under server-only access so edits/deletions to a list do not corrupt history. Prefer a transaction when creating a game and when completing it plus updating review/progress state. Use migrations in all environments; production deploy runs migrations as a controlled release step, not on every application replica boot.

## 5. REST API outline

Base path: `/api/v1`; JSON; consistent error shape such as `{ "code": "VALIDATION_ERROR", "message": "...", "details": [...] }`. Use pagination for list/history endpoints. Require authentication except explicitly identified public starter-list reads and guest preview.

| Method & path | Purpose |
|---|---|
| `POST /auth/register` | Create account; return safe user/session representation. |
| `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | Session lifecycle and current user. |
| `GET /word-lists` | Return system lists and caller-owned lists; paginated. |
| `POST /word-lists`, `GET /word-lists/:id`, `PATCH /word-lists/:id`, `DELETE /word-lists/:id` | Manage owned lists. |
| `GET /word-lists/:id/words` | Paginated list contents. |
| `POST /word-lists/:id/words`, `PATCH /words/:id`, `DELETE /words/:id` | Manage words with ownership and validation checks. |
| `POST /word-lists/:id/import-preview` | Parse bounded `.txt`/`.doc`/`.docx` upload or pasted text; return preview rows and row issues without writing. CSV may be optional secondary compatibility. |
| `POST /word-lists/:id/import` | Commit selected/corrected preview rows after server-side revalidation. |
| `POST /games` | Start game for selected list; return game ID, rules, and eligible guess dictionary as appropriate, but never answer. |
| `POST /games/:id/guesses` | Submit one guess; return per-letter feedback, attempts remaining, and completion status; reveal answer only after game ends. |
| `GET /games/:id` | Read caller's game state with answer redaction while active. |
| `GET /progress/summary`, `GET /progress/review-items` | Recent stats, streak, and due/missed words. |

For feedback, mark exact-position matches first, then assign remaining letters as present only up to their remaining answer frequency. Return structured values (`CORRECT`, `PRESENT`, `ABSENT`). DTO validation normalizes guesses and allows 3–9 letters; the service enforces the selected length and stored dictionary pool. Easy/Medium/Hard persist 7/6/5 guesses and 3/2/1 uses of each hint respectively. Game kind is persisted to leave room for future game modules.

## 6. Frontend behavior

- Keep puzzle rendering and transient input state client-side; server responses are authoritative for accepted guesses and completion.
- Use accessible labels, visible keyboard focus, reduced-motion support, responsive layout, and feedback conveyed by symbol/text plus color.
- Provide predictable loading, empty, offline/network error, conflict, and validation states. Avoid optimistic final game state if API submission fails.
- Keep API base URL and public configuration separate from secrets; support production and local origins.

## 7. Testing strategy

- **Unit:** guess scoring (including repeated letters), normalization, answer selection, streak calculations, text/document extraction and row validation, and authorization policies.
- **API integration:** NestJS modules against disposable PostgreSQL; verify migrations, constraints, transactions, redaction, and user isolation.
- **E2E:** register/login, create/import list, start/complete game, refresh and verify progress; cover mobile viewport and keyboard navigation.
- **Security-focused cases:** cross-user ID access, malformed/oversized text/document files, embedded-content handling, SQL/HTML payloads, rate limiting, session expiry, and answer leakage.
- Use deterministic seeded fixtures and stable test dictionaries. Avoid relying on external APIs in CI.

## 8. Containers and local development

- Provide Dockerfiles for web and API with multi-stage builds, pinned base images, non-root runtime users, minimal runtime dependencies, and health checks.
- `docker-compose.yml` should start PostgreSQL and the app dependencies with named development volume and health-gated API startup. Publish only necessary local ports; do not use production secrets or seed credentials.
- Document setup, migration, deterministic seed, test, and reset commands. Keep development reload behavior distinct from production images.
- Use environment variables validated at startup (`DATABASE_URL`, session/auth secrets, allowed origins, port, and email provider settings). Supply `.env.example` with placeholders only.

## 9. GitHub Actions CI/CD

On pull requests and pushes to the default branch: install from lockfile, lint, format check, typecheck, unit tests, API integration tests with PostgreSQL service, web/API production builds, and dependency/security audit. Cache package downloads safely; do not expose deployment secrets to untrusted fork PRs.

On merge to the default branch: build and tag immutable container images with commit SHA, publish to a container registry, deploy to staging, run health/smoke checks, then promote to production through a protected environment/manual approval if the hosting platform supports it. Run one-off database migrations before app rollout. Keep rollback to the prior image available; use backward-compatible expand/migrate/contract schema changes.

## 10. Deployment and operations

- A simple portfolio deployment can use a managed container host, managed PostgreSQL, and a static frontend host/CDN. Alternatively host web and API containers together behind a TLS-terminating reverse proxy.
- Separate staging and production databases/secrets. Set a custom domain, HTTPS, health/readiness checks, and API CORS allowlist.
- Enable automated database backups and test restoration. Define retention and deletion handling, monitor uptime, API errors, latency, DB connections, and disk usage. Keep structured logs with request IDs and no sensitive user data.
- Deploy migrations in a controlled release job. Start with one API service and scale only when observed traffic requires it.
- Budget for hosting, managed database, email delivery, and image registry; free tiers and quotas change, so verify provider limits and backup/export options when selecting a host.

## 11. Future expansion seams

Keep games, list ownership, and scoring rules separated enough to add challenge IDs and asynchronous results later. Leaderboards require abuse-resistant scoring, privacy controls, moderation, and clear ranking windows; real-time head-to-head play likely adds WebSockets and matchmaking. Neither is needed to validate the MVP.
