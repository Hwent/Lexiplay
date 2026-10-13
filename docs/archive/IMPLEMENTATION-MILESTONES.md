# Implementation milestone records

Historical validation and changed-file reports from 2026-10-12. These are records of earlier commits, not current instructions or current test counts. Current behavior is in [Games and accounts](../GAMES_AND_ACCOUNTS.md).

## Original games milestone validation and changed files

Local verification passed: 19 API tests (including two real PostgreSQL integration cases), 33 web tests, workspace typechecking, and production builds. Live browser checks covered mobile/desktop setup, nine-letter input, hints, refresh restoration, and the narrow account menu. Real external email delivery was not tested. CI execution on GitHub is separate from these local results.

Changed files for this milestone, relative to the repository root:

- Configuration: `.env.example`, `.gitignore`, `.github/workflows/ci.yml`, `scripts/dev.mjs`.
- Accounts: `apps/api/src/modules/accounts/account.controller.ts`, `account.dto.ts`, `account.repository.ts`, `account.service.ts`, `account-mail.service.ts`, `account-mail.service.test.ts`, `accounts.module.ts`, and `accounts.e2e.test.ts` (all under the same accounts directory).
- Games: `apps/api/src/modules/games/game.controller.ts`, `game.service.ts`, `game.repository.ts`, `game.types.ts`, `game.dto.ts`, `submit-guess.dto.ts`, `statistics.controller.ts`, and `games.module.ts` (all under the same games directory).
- API checks: `apps/api/src/health.e2e.test.ts`, `apps/api/src/persistence.e2e.test.ts`.
- Web: `apps/web/src/App.tsx`, `App.test.tsx`, `AccountPanel.tsx`, `GameCatalog.tsx`, `GameUpdates.test.tsx`, `StatisticsPanel.tsx`, `game-updates.css`, and `main.tsx` (all under the same web source directory).
- Documentation: `README.md`, `docs/DEVELOPMENT.md`, `docs/learn.md`, `docs/GAMES_AND_ACCOUNTS.md`, `outputs/docs/PRD.md`, `outputs/docs/TECHNICAL_DESIGN.md`, `outputs/docs/WORD_LIST_DESIGN.md`.

The previously untracked `AGENTS.md` and previously deleted `docs/react-standard-evaluation.md` were not part of this milestone’s changes.

## Account page milestone

Account functionality moved from the header dropdown to `/account`; the header retains only a basic status link. Verification/reset email links open the dedicated page. The root `.env` is loaded only for local development through Node’s built-in loader; no dependency was added.

Validation passed: 19 API tests, 37 web tests, workspace typechecking, and production builds. The live Resend onboarding sender delivered a verification message to the requested Gmail inbox. The received link opened Account and the temporary account’s verification flag became true in the disposable local PostgreSQL database. The preview was then switched back to the normal local database. No production resource was changed; API keys and tokens were not committed.

Changed files:

- `apps/web/src/AccountPanel.tsx` renamed to `AccountPage.tsx`; added `AccountPage.test.tsx`, `AccountStatus.tsx`, and `useAccount.ts` in that directory.
- `apps/web/src/App.tsx`, `App.test.tsx`, `GameUpdates.test.tsx`, `styles.css`, and `game-updates.css`.
- `apps/api/src/modules/accounts/account-mail.service.ts`, `account-mail.service.test.ts`, and `account.service.ts`.
- `.env.example`, `scripts/dev.mjs`, `README.md`, `docs/DEVELOPMENT.md`, `docs/learn.md`, and this document.

The private root `.env` is gitignored. Real mail currently uses the onboarding sender for the operator’s own address; sending to other users requires a verified sender domain. Local verification links require the matching development server to stay running.

## Optional email and account controls milestone

Signup now requires only username/password; email and verification are optional, with verification off by default. Account has a responsive layout, Show/Hide password controls, an inbox confirmation for recovery, an authenticated form for adding a recovery email, and permanent deletion with current-password and typed confirmation. Deletion removes owned learning data and links in one transaction.

Validation passed: 21 API tests (including three real PostgreSQL integration cases), 41 web tests, workspace typechecking, and production builds. Browser checks covered desktop signup, unchecked verification, hidden passwords, the 390px mobile form without horizontal overflow, and opening/cancelling deletion. Destructive tests used a disposable local database and mocked email. No live account was deleted and no new external verification/recovery email was sent during this milestone. No dependencies were added.

Files changed in this milestone:

- Accounts: `apps/api/src/modules/accounts/account.controller.ts`, `account.dto.ts`, `account.repository.ts`, `account.service.ts`, and `accounts.e2e.test.ts`.
- Persistence: `apps/api/src/modules/games/game.repository.ts` and `apps/api/src/persistence.e2e.test.ts`.
- Account UI: `apps/web/src/AccountPage.tsx`, `AccountPage.test.tsx`, `AccountStatus.tsx`, `PasswordField.tsx`, `account.css`, and `useAccount.ts`.
- Web integration: `apps/web/src/App.test.tsx`, `game-updates.css`, and `main.tsx`.
- Documentation: `README.md`, `docs/DEVELOPMENT.md`, `docs/GAMES_AND_ACCOUNTS.md`, `docs/learn.md`, `outputs/docs/PRD.md`, and `outputs/docs/TECHNICAL_DESIGN.md`.

Known limits: username-only accounts cannot recover a forgotten password without a previously linked email; existing recovery addresses cannot yet be changed/removed. Backup retention, account export, and versioned database migrations remain future work.

## Guest progress and formal email milestone

Guest words/games now move into the account after signup or sign-in, with account-bound retries and puzzle restoration. Verification and reset messages have formal HTML/plain-text templates. No dependencies were added and no external email was sent for this milestone.

Validation passed: 25 API tests (six real PostgreSQL cases), 49 web tests, workspace typechecking, and production builds. Integration coverage includes signup/login transfer, concurrent retries, preservation of existing words, active guesses/hints, Statistics, restart, account isolation, deletion cleanup, and rollback. Browser tests cover large batches, lost responses, concurrent local edits, retry/reload, and puzzle/word UI restoration. A local dummy-link email preview was inspected through browser accessibility content; screenshot capture was unavailable, and rendering in external email clients was not exercised.

Files changed:

- Accounts: `apps/api/src/modules/accounts/account.repository.ts`, `account-email.ts`, `account-mail.service.ts`, and `account-mail.service.test.ts`.
- Games/progress: `apps/api/src/modules/games/game.controller.ts`, `game.repository.ts`, `games.module.ts`, `guest-cookie.ts`, `progress-transfer.controller.ts`, `progress-transfer.dto.ts`, and `progress-transfer.repository.ts`.
- Word storage: `apps/api/src/modules/word-lists/word-list.repository.ts` and `word-lists.module.ts`; integration coverage in `apps/api/src/persistence.e2e.test.ts`.
- Web: `apps/web/src/AccountPage.tsx`, `AccountPage.test.tsx`, `App.tsx`, `App.test.tsx`, `GameUpdates.test.tsx`, `GuestProgress.test.tsx`, `useAccount.ts`, `services/guest-progress.ts`, and `services/guest-progress.test.ts`.
- Docs: `README.md`, `docs/DEVELOPMENT.md`, `docs/GAMES_AND_ACCOUNTS.md`, `docs/learn.md`, `outputs/docs/PRD.md`, and `outputs/docs/TECHNICAL_DESIGN.md`.

## Deployment implementation milestone

Local validation passed: 27 API tests (including six disposable PostgreSQL cases), 49 web tests, workspace typechecking, and production builds. The compiled server was smoke-tested locally: browser routes and its generated JavaScript asset returned 200, health returned JSON, and missing API/asset paths returned 404. The manual Bash wizard passed syntax checking; ShellCheck was unavailable. The dictionary wrapper passed Node syntax checking and has not been executed against a cloud database.

Files changed for this setup: `apps/api/src/main.ts`, `apps/api/src/http-setup.ts`, `apps/api/src/http-setup.test.ts`, `scripts/seed-deployed.mjs`, root `package.json`, `.env.example`, `README.md`, `docs/DEVELOPMENT.md`, `docs/learn.md`, and this guide. No project dependency was added. The generated five-stage walkthrough is a local, one-run artifact rather than a committed deployment automation.
