# Games, Statistics, and accounts

Current implementation, updated 2026-10-12. This document describes shipped behavior; the broader deployment and review-queue work in the PRD remains future work.

## Games

The navigation opens **Games** at `/games`; `/play` remains a compatible entry URL. `GameCatalog.tsx` lists available games. The first entry is Word puzzle. Add a catalogue entry and its game view when another game is implemented; do not reuse word-puzzle rules for unrelated games. The API stores `kind: "word-puzzle"` with every game so future game types can have their own rules and statistics.

Word puzzle accepts 3–9 letters, with these settings:

| Difficulty | Guesses | Remove letters uses | Reveal a letter uses |
| --- | --- | --- | --- |
| Easy | 7 | 3 | 3 |
| Medium (default) | 6 | 2 | 2 |
| Hard | 5 | 1 | 1 |

The default length is five. Remove letters reveals up to three previously unknown letters absent from the answer per use. Reveal a letter reveals one previously unknown answer letter without its position. Hints do not consume guesses; exhausted hints are disabled. If no letters remain to reveal, the API rejects the hint without consuming its budget.

Answers and valid guesses come from the database dictionary, filtered to lowercase `a`–`z`, the selected length, and a nonempty definition. Personal-word mode restricts answers to the learner’s saved words intersected with that pool. Known and Unfamiliar words are both eligible. Invalid guesses never consume an attempt. Guess DTOs normalize whitespace/case, accept 3–9 characters, and leave the selected-length and dictionary checks to the service. Tests install the same global validation pipe as the running API.

`practice_games` stores an owner key and server-only JSON state: game kind, answer, dictionary-pool snapshot, rules, hint counts, revealed letters, and timestamps. `practice_guesses` stores accepted results and definitions in position order, with a unique `(game_id, position)` key. Guesses and game changes commit in one transaction. Row locks serialize simultaneous guesses and hints. Reads use a consistent database snapshot. Answers and dictionary pools are removed from active-game responses; completion reveals the answer in the final guess result.

Signed-in games belong to the account. Guest games belong to an opaque, HttpOnly, SameSite=Lax browser cookie; only its SHA-256 hash is stored. Cookies use Secure in production. Another account or browser receives 404 for a game it does not own. Guest cookies last 30 days. Sign-in and signup transfer the current browser’s guest games into the authenticated account, including unfinished games and completed history.

Accepted guesses, definitions, hints, and completed games survive API restart. The browser stores the latest game ID in `lexiplay-last-game` and restores it on reload. Navigating between pages retains the current puzzle. Choosing a new puzzle clears that browser pointer; an unfinished previous puzzle remains stored but does not count toward Statistics. Successful sign-in/signup restores the latest puzzle after its ownership is checked/transferred. Sign-out clears the displayed puzzle and pointer so another account cannot inherit its UI. Without browser storage, automatic resume is unavailable.

### Saving guest progress to an account

After authentication, the browser snapshots its local words and latest game ID. `POST /progress/claim` merges up to 100 words per batch into the account’s single list and moves every game owned by the guest cookie into the account. IDs, accepted guesses, hint state, definitions, and completion timestamps remain intact. Only the server-held game state is transferred; clients cannot supply guesses or a guest owner key. The latest game resumes only if the authenticated account owns it. Completed games immediately count toward Statistics.

New words preserve Known/Unfamiliar status and personal definitions. Repeated terms are normalized/deduplicated, and existing account words keep their definitions and status. Each batch uses one PostgreSQL transaction for words, games, guest ownership, and its receipt. `progress_transfers` binds a batch ID and payload hash to one account, making retries idempotent. `guest_progress_claims` prevents another account or an in-flight guest request from reusing a claimed guest identity. These records cascade on account deletion. A successfully claimed guest cookie is expired.

`lexiplay-progress-transfer` stores the pending snapshot, account binding, batch IDs, acknowledged position, and totals before requests begin. Local words are cleared only after all batches are acknowledged; new/edited words from another tab remain. A failed transfer leaves authentication successful, retains local data, and shows Retry saving progress on Account. Reloading retries a pending transfer for the same account. Signing in to a different account cannot take over that pending snapshot. Puzzle controls pause while transfer is running.

Transfer requires access to the current browser origin’s local storage and the original guest cookie. Different browser origins/dev ports cannot read each other’s words. Guest games whose cookie has been lost or expired cannot be claimed using a game ID alone. Very large transfers may reach the endpoint rate limit and can resume via retry.

## Statistics

`/progress` shows signed-in learners completed games, win rate, solved words, current practice streak, the distribution of winning guesses (1–7), and the newest 20 completed games. Guest and empty states explain how to begin. Failed requests support retry. Unfinished games are excluded.

The browser supplies its IANA timezone. The API validates it and groups UTC completion timestamps into local calendar days. A streak counts consecutive days with at least one completed puzzle, win or loss. It can end today or yesterday; multiple puzzles on a day count once. Changing timezone recalculates the streak from stored timestamps. Tests cover midnight and daylight-saving transitions.

## Accounts and email

Account functions live on the dedicated `/account` page: sign-in, registration, profile/status, sign-out, recovery, optional verification, and deletion. The shared header contains only a compact Guest/Signed in status link. `useAccount` keeps the current account mounted in `App`, so page navigation does not repeat session checks or lose sign-in status. Failed session checks have a retry state on Account. Registration requires a unique username and an 8–128 character password. Email is optional and stored as null when omitted/blank. Usernames are case-insensitive, 3–32 letters/numbers/underscores, and start with a letter. Sign-in accepts username or a linked email. Existing accounts retain email sign-in and receive a unique `learner_<id>` username during lazy schema setup; `/auth/me` and Account show it. Passwords use the existing scrypt implementation; session tokens are hashed before storage.

Verification is off by default. Signup sends a message only when an email is supplied and the optional checkbox is selected (`sendVerification: true`). Users can request verification later from Account. An unverified account can sign in and practise. Registration remains usable when requested email delivery is unavailable and offers a retry. A signed-in user without email can add a unique recovery address with their current password; this sends no automatic verification message. Existing recovery addresses cannot be changed through this endpoint.

Forgot password opens an email form and a neutral inbox confirmation; known/unknown addresses receive the same response, including when delivery fails. Recovery requires an email linked before the password was forgotten. A username-only account cannot recover a lost password. Password fields have accessible Show/Hide buttons and return to hidden when cleared or switching modes. The responsive Account page groups profile, recovery, and deletion settings; errors use alert feedback.

Delete account opens a confirmation form requiring the current password and the exact text `DELETE`. Cancel clears the fields. A successful deletion clears the cookie and account/game UI. One PostgreSQL transaction removes the user, owned games/guesses, personal lists/words, sessions, and reset/verification links; other accounts, guest data, and the shared dictionary remain. Game creation holds a lock on its account row so a concurrent deletion cannot leave an orphan game. Deletion is permanent in the running application; production backup retention remains a deployment responsibility.

Email verification links expire after 24 hours; password reset links after 30 minutes. Only SHA-256 token hashes are stored in `account_actions`. Each new request replaces the previous link of the same type. Token consumption is transactional and single-use. Resetting a password revokes all existing sessions. Email links target `/account#action=verify&token=...` or `/account#action=reset&token=...`. Account removes the token from the address bar and offers a confirmation form. Older root-page action links open Account too. After verification, an existing signed-in session is refreshed so a link for another email cannot incorrectly mark the current account verified.

Account emails use formal subjects and a branded HTML template with an action button, fallback URL, expiry/single-use instructions, a safe-ignore notice, and a plain-text alternative. The verification message explicitly says verification is optional. Dynamic URLs are HTML-escaped; templates do not include passwords or server credentials. Reset messages retain their 30-minute expiry and clarify that the password is unchanged until reset completion.

| API route | Request / behavior |
| --- | --- |
| `POST /games` | `{ kind?, wordLength?, difficulty?, playWithMyWords? }`; create owned game |
| `GET /games/:id` | Restore the caller’s game, with active answer redaction |
| `POST /games/:id/guesses` | `{ guess }`; accept or reject without consuming invalid attempts |
| `POST /games/:id/hints` | `{ type: "unused" \| "present" }`; persist hint state |
| `GET /progress/summary?timezone=America%2FToronto` | Authenticated completed-game statistics |
| `POST /progress/claim` | Authenticated `{ accountId, transferId, words, lastGameId? }`; UUID IDs, max 100 validated words with Known/Unfamiliar status; guest ownership proven by cookie |
| `POST /auth/register` | `{ username, password, email?, sendVerification? }`; verification defaults off |
| `POST /auth/login` | `{ identifier, password }`; legacy `{ email, password }` also works |
| `POST /auth/forgot-password` | `{ email }`; generic recovery response |
| `POST /auth/reset-password` | `{ token, password }`; revoke sessions |
| `POST /auth/verification-request` | Authenticated verification resend |
| `POST /auth/verify-email` | `{ token }`; verify once |
| `POST /auth/email` | Authenticated `{ email, password }`; add a recovery email only when none is linked |
| `DELETE /auth/account` | Authenticated `{ password, confirmation: "DELETE" }`; delete owned data, revoke sessions, and clear cookie |

Paths above have the `/api/v1` prefix. Account endpoints are throttled; game and Statistics endpoints also use the existing throttler.

## Local and deployed email

No email SDK dependency was added. `AccountMailService` uses Node fetch with the [Resend email API](https://resend.com/docs/api-reference/emails/send-email).

For development, `MAIL_MODE=local` writes email previews to `apps/api/.local-mail/` when using `pnpm dev`. That directory is gitignored and never served by the app. Open the local message file yourself to use its link; do not paste its token into logs or commit it. The launcher sets `PUBLIC_WEB_ORIGIN` to the selected web URL. Preview files contain expiring access links and should be removed when no longer needed.

For deployment, set `MAIL_MODE=resend`, `PUBLIC_WEB_ORIGIN` to the HTTPS frontend origin, `MAIL_FROM` to a verified sender, and `RESEND_API_KEY` in the server environment. Production refuses local mail mode. Real delivery needs this configuration and has not been exercised by automated tests. No provider account, sender domain, or production resource is provisioned by these changes.

For a first real delivery test without a domain:

1. Create a Resend account using the email that will receive the test.
2. In [Resend API Keys](https://resend.com/api-keys), create a `LexiPlay` key with **Sending access**. Copy the value when created; it cannot be viewed again. See [API key management](https://resend.com/docs/dashboard/api-keys/introduction).
3. Copy `.env.example` to the gitignored root `.env`, then set `MAIL_MODE=resend`, `MAIL_FROM="LexiPlay <onboarding@resend.dev>"`, and `RESEND_API_KEY` to that key. Leave `PUBLIC_WEB_ORIGIN` unset locally; the launcher uses its selected web URL. Existing shell variables take precedence over `.env`.
4. Restart `pnpm dev`, open Account, and register with an email and the verification checkbox selected, or request verification from your profile. The [onboarding sender can deliver only to the email used for the Resend account](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain). Add and verify a domain to send to other addresses; a Gmail address is the recipient, not the Resend sender.

Local links work only on the computer running LexiPlay, while that dev server is active. Inbox receipt, successful link consumption, and provider acceptance are separate checks; a local preview is not evidence of Gmail delivery. Never paste the API key or verification token into chat or commit them.

## Verification and remaining limits

Run `pnpm test`, `pnpm typecheck`, and `pnpm build`. Ordinary tests use deterministic adapters and mocked mail. For real PostgreSQL tests, point `TEST_DATABASE_URL` at a **separate disposable database named `lexiplay_test_*`**. The integration suite refuses other database names. GitHub CI provisions its own PostgreSQL service and runs these checks.

Real-database coverage includes API restart, concurrent guesses, ownership, persisted Statistics, optional recovery email, verification, expired/single-use links, session revocation, and account deletion with cleanup and owner isolation. UI tests cover nine-letter difficulty controls, hints, resume, Statistics, signup without email, verification opt-in, password visibility, recovery, and deletion confirmation/failure/success.

Repositories still apply schema changes lazily; standalone versioned migrations remain future work. Statistics calculates all-time metrics from completed games and displays only the latest 20; history pagination and SQL aggregation are future scaling work. A missed-word review queue and production backup/deployment setup remain unimplemented. Account export and changing/removing an existing recovery email are not implemented.

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
