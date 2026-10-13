# Development guide

Use the [documentation index](README.md) to choose a guide, [codebase tour](learn.md) to trace implementation, and [database manual](DATABASE-MANUAL.md) for database connections, updates, backup, recovery, and parallel environments.

## Local setup

Prerequisites: Node.js 22+, pnpm 11.25.0, and Docker Desktop. Run from the repository root:

```powershell
pnpm install
if (!(Test-Path .env)) { Copy-Item .env.example .env }
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
docker compose up -d database
pnpm dev
```

Games need a populated dictionary. On first setup, follow the database manual's local dictionary import; if using a production copy, its dictionary is already populated. The launcher loads root `.env`, chooses free loopback ports, and prints the browser URL. Shell variables take precedence. It forces development mode, localhost binding, Vite serving, and local email previews, and rejects remote database URLs. Standalone API/import commands read their own environment and do not use that guard. Restart the launcher after configuration changes.

## Module boundaries

- Web owns presentation, navigation, accessibility, and transient input state. Shared HTTP transport is in `apps/web/src/services/api-client.ts`; feature code owns caching and retry decisions.
- API owns authentication, authorization, validation, puzzle rules, and persistence. Controllers translate HTTP; services coordinate use cases; repositories encapsulate PostgreSQL access.
- Shared contains stable contracts and primitive shared types. Do not put database models or server business logic there.
- Database changes currently run lazily in repositories. Separate versioned migrations remain future work; inspect SQL and rehearse on a copy before release.

Preserve the current React + TypeScript + NestJS + PostgreSQL architecture. Keep features cohesive and avoid moving unrelated modules to satisfy a generic folder template. The API uses `pg`, not Prisma. Gameplay and dictionary search use `dictionary_words`; old static vocabulary files are historical snapshots. Preserve their license notices while retaining those files.

## React and API conventions

Use PascalCase `.tsx` component files with default exports, and named exports for utilities in lowercase hyphenated `.ts` files. Follow existing two-space indentation, single quotes, semicolons, and TypeScript types. The current app uses History API navigation and shared stylesheets; React Router and CSS Modules are not required migrations. The [original React template](reference/REACT-TEMPLATE.md) is preserved as a reference, not the current architecture standard.

Use immutable state updates and functional setters when computing from prior state. Derive values during rendering rather than storing duplicate state. Use refs for DOM/bookkeeping. Put user actions in event handlers; clean up effects for requests, timers, storage, and browser events, and handle stale responses.

Use semantic controls, labeled inputs, accessible names for icon buttons, visible focus, and feedback beyond color. Show loading/error/empty states and clear busy state after asynchronous work. Keep feature-specific messages and personal definitions separate from canonical dictionary caches.

Preserve `lexiplay:before-route-change`, which flushes queued signed-in edits. Guest words and pending transfer state live in browser storage; an optimistic UI update is not proof of a PostgreSQL commit. Server validation and ownership checks remain authoritative. Account deletion and guest transfers must coordinate game/list cleanup transactionally; new account-owned storage must participate in that cleanup.

## Verification

```powershell
pnpm test
pnpm typecheck
pnpm build
```

Root tests run launcher checks plus API/web Vitest suites. API HTTP tests use deterministic adapters; real persistence tests require a separate disposable `lexiplay_test_*` database through `TEST_DATABASE_URL`. GitHub CI provisions its own PostgreSQL service. Browser tests use jsdom and mocked APIs. Live dictionary imports and actual mail delivery are separate operator checks.

Keep meaningful tests near the behavior they protect. No lint/format command or separate automated real-browser journey suite is currently configured. Use [Games and accounts](GAMES_AND_ACCOUNTS.md) and [word-list design](../outputs/docs/WORD_LIST_DESIGN.md) for feature contracts rather than duplicating them here.

## Releases and private configuration

Push feature branches for review; review/merge to `main` and deliberately deploy through the [Render guide](DEPLOYMENT.md). Follow project instructions for committing/pushing completed work. Never commit `.env*` secrets, database archives, account data, or mail-preview tokens. Production environment settings live in Render; local development remains independent. The database manual explains schema-changing releases and why code rollback does not reverse database changes.
