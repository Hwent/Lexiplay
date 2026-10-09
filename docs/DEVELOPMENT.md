# Development guide

## Component boundaries

- **Web** owns presentation, navigation, accessibility, and transient input state. It calls the API through a typed client/contract boundary.
- **API** owns authentication, authorization, validation, puzzle rules, and persistence. Controllers translate HTTP; services coordinate use cases; domain modules own business rules.
- **Shared** contains stable request/response contracts and primitive shared types only. Do not put database models or server business logic here.
- **Database** belongs to the API. Schema changes are migrations; application services depend on persistence interfaces where that keeps domain behavior independently testable.

Keep each feature cohesive. Prefer small modules with explicit exports over cross-importing another module's internals. Add unit tests for deterministic rules, API integration tests for persistence/authorization, and end-to-end tests for user journeys. Use fixed fixtures and avoid external services in routine checks.

## Local setup

Use Node.js 22+, pnpm 10+, and Docker Desktop. Copy `.env.example` to `.env` when service configuration is introduced. Never commit secrets or real user data. Run `pnpm install` from the repository root so the lockfile governs every workspace package.

The initial scaffold does not yet contain application dependencies or runtime services. Add each framework and its configuration with the first implementation milestone, then commit the generated lockfile alongside the package manifest changes.

## GitHub setup

Create an empty GitHub repository, then add it as `origin` and push `main` (commands are in the root README). Configure pull requests to run the repository checks before merging. Add deployment secrets only through GitHub Actions environments after a deployment target is selected.
