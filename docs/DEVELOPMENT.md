# Development guide

## Component boundaries

- **Web** owns presentation, navigation, accessibility, and transient input state. It calls the API through a typed client/contract boundary.
- **API** owns authentication, authorization, validation, puzzle rules, and persistence. Controllers translate HTTP; services coordinate use cases; domain modules own business rules.
- **Shared** contains stable request/response contracts and primitive shared types only. Do not put database models or server business logic here.
- **Database** belongs to the API. Schema changes are migrations; application services depend on persistence interfaces where that keeps domain behavior independently testable.

Keep each feature cohesive. Prefer small modules with explicit exports over cross-importing another module's internals. Add unit tests for deterministic rules, API integration tests for persistence/authorization, and end-to-end tests for user journeys. Use fixed fixtures and avoid external services in routine checks.

## Vocabulary lists

Guess and answer words are stored separately by length in `packages/shared/vocabulary`. The API validates each guess against the matching length bucket and chooses answers only from the answer bucket. Keep the source snapshot and required notices with any list update; see `packages/shared/vocabulary/README.md` before redistributing the five-letter guess list.

## Local setup

Use Node.js 22+, pnpm 10+, and Docker Desktop. Copy `.env.example` to `.env` when service configuration is introduced. Never commit secrets or real user data. Run `pnpm install` from the repository root so the lockfile governs every workspace package.

Run `pnpm dev` to start the API and web development server. The dev script selects free loopback ports and prints the browser URL, which also works in environments that reserve common fixed development ports. The API uses in-memory practice games for this early slice; restarting it clears active games.

## GitHub setup

Create an empty GitHub repository, then add it as `origin` and push `main` (commands are in the root README). Configure pull requests to run the repository checks before merging. Add deployment secrets only through GitHub Actions environments after a deployment target is selected.
