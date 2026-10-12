# Games, Statistics, and accounts

Current implementation, updated 2026-10-11. This document describes shipped behavior; the broader deployment and review-queue work in the PRD remains future work.

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

Signed-in games belong to the account. Guest games belong to an opaque, HttpOnly, SameSite=Lax browser cookie; only its SHA-256 hash is stored. Cookies use Secure in production. Another account or browser receives 404 for a game it does not own. Guest cookies last 30 days. Guest games do not transfer into an account after sign-in.

Accepted guesses, definitions, hints, and completed games survive API restart. The browser stores the latest game ID in `lexiplay-last-game` and restores it on reload. Navigating between pages retains the current puzzle. Choosing a new puzzle clears that browser pointer; an unfinished previous puzzle remains stored but does not count toward Statistics. Signing in/out clears the displayed puzzle and pointer so another account cannot inherit its UI. Without browser storage, automatic resume is unavailable.

## Statistics

`/progress` shows signed-in learners completed games, win rate, solved words, current practice streak, the distribution of winning guesses (1–7), and the newest 20 completed games. Guest and empty states explain how to begin. Failed requests support retry. Unfinished games are excluded.

The browser supplies its IANA timezone. The API validates it and groups UTC completion timestamps into local calendar days. A streak counts consecutive days with at least one completed puzzle, win or loss. It can end today or yesterday; multiple puzzles on a day count once. Changing timezone recalculates the streak from stored timestamps. Tests cover midnight and daylight-saving transitions.

## Accounts and email

Registration requires an email, a unique username, and an 8–128 character password. Usernames are case-insensitive, 3–32 letters/numbers/underscores, and start with a letter. Sign-in accepts username or email. Existing accounts retain email sign-in and receive a unique `learner_<id>` username during lazy schema setup; `/auth/me` and the account panel show it. Passwords use the existing scrypt implementation; session tokens are hashed before storage.

Verification is requested on registration and can be resent from the account panel. An unverified account can sign in and practise; the panel displays verification pending. Registration remains usable when email delivery is unavailable and tells the browser to offer a retry. Password recovery always responds identically for known/unknown email addresses, including when delivery fails.

Email verification links expire after 24 hours; password reset links after 30 minutes. Only SHA-256 token hashes are stored in `account_actions`. Each new request replaces the previous link of the same type. Token consumption is transactional and single-use. Resetting a password revokes all existing sessions. Email links carry the action/token in the URL fragment; the account panel removes it from the address bar when loaded and offers an explicit confirmation form.

| API route | Request / behavior |
| --- | --- |
| `POST /games` | `{ kind?, wordLength?, difficulty?, playWithMyWords? }`; create owned game |
| `GET /games/:id` | Restore the caller’s game, with active answer redaction |
| `POST /games/:id/guesses` | `{ guess }`; accept or reject without consuming invalid attempts |
| `POST /games/:id/hints` | `{ type: "unused" \| "present" }`; persist hint state |
| `GET /progress/summary?timezone=America%2FToronto` | Authenticated completed-game statistics |
| `POST /auth/register` | `{ username, email, password }` |
| `POST /auth/login` | `{ identifier, password }`; legacy `{ email, password }` also works |
| `POST /auth/forgot-password` | `{ email }`; generic recovery response |
| `POST /auth/reset-password` | `{ token, password }`; revoke sessions |
| `POST /auth/verification-request` | Authenticated verification resend |
| `POST /auth/verify-email` | `{ token }`; verify once |

Paths above have the `/api/v1` prefix. Account endpoints are throttled; game and Statistics endpoints also use the existing throttler.

## Local and deployed email

No email SDK dependency was added. `AccountMailService` uses Node fetch with the [Resend email API](https://resend.com/docs/api-reference/emails/send-email).

For development, `MAIL_MODE=local` writes email previews to `apps/api/.local-mail/` when using `pnpm dev`. That directory is gitignored and never served by the app. Open the local message file yourself to use its link; do not paste its token into logs or commit it. The launcher sets `PUBLIC_WEB_ORIGIN` to the selected web URL. Preview files contain expiring access links and should be removed when no longer needed.

For deployment, set `MAIL_MODE=resend`, `PUBLIC_WEB_ORIGIN` to the HTTPS frontend origin, `MAIL_FROM` to a verified sender, and `RESEND_API_KEY` in the server environment. Production refuses local mail mode. Real delivery needs this configuration and has not been exercised by automated tests. No provider account, sender domain, or production resource is provisioned by these changes.

## Verification and remaining limits

Run `pnpm test`, `pnpm typecheck`, and `pnpm build`. Ordinary tests use deterministic adapters and mocked mail. For real PostgreSQL tests, point `TEST_DATABASE_URL` at a **separate disposable database named `lexiplay_test_*`**. The integration suite refuses other database names. GitHub CI provisions its own PostgreSQL service and runs these checks.

Real-database coverage includes API restart, concurrent guesses, ownership, persisted Statistics, verification, expired/single-use links, and session revocation. UI tests cover nine-letter difficulty controls, hints, resume, Statistics, and account actions. Live mobile verification covers nine-letter guesses and hint restoration.

Repositories still apply schema changes lazily; standalone versioned migrations remain future work. Statistics calculates all-time metrics from completed games and displays only the latest 20; history pagination and SQL aggregation are future scaling work. A missed-word review queue, account deletion, and production backup/deployment setup remain unimplemented.

## Milestone validation and changed files

Local verification passed: 19 API tests (including two real PostgreSQL integration cases), 33 web tests, workspace typechecking, and production builds. Live browser checks covered mobile/desktop setup, nine-letter input, hints, refresh restoration, and the narrow account menu. Real external email delivery was not tested. CI execution on GitHub is separate from these local results.

Changed files for this milestone, relative to the repository root:

- Configuration: `.env.example`, `.gitignore`, `.github/workflows/ci.yml`, `scripts/dev.mjs`.
- Accounts: `apps/api/src/modules/accounts/account.controller.ts`, `account.dto.ts`, `account.repository.ts`, `account.service.ts`, `account-mail.service.ts`, `account-mail.service.test.ts`, `accounts.module.ts`, and `accounts.e2e.test.ts` (all under the same accounts directory).
- Games: `apps/api/src/modules/games/game.controller.ts`, `game.service.ts`, `game.repository.ts`, `game.types.ts`, `game.dto.ts`, `submit-guess.dto.ts`, `statistics.controller.ts`, and `games.module.ts` (all under the same games directory).
- API checks: `apps/api/src/health.e2e.test.ts`, `apps/api/src/persistence.e2e.test.ts`.
- Web: `apps/web/src/App.tsx`, `App.test.tsx`, `AccountPanel.tsx`, `GameCatalog.tsx`, `GameUpdates.test.tsx`, `StatisticsPanel.tsx`, `game-updates.css`, and `main.tsx` (all under the same web source directory).
- Documentation: `README.md`, `docs/DEVELOPMENT.md`, `docs/learn.md`, `docs/GAMES_AND_ACCOUNTS.md`, `outputs/docs/PRD.md`, `outputs/docs/TECHNICAL_DESIGN.md`, `outputs/docs/WORD_LIST_DESIGN.md`.

The previously untracked `AGENTS.md` and previously deleted `docs/react-standard-evaluation.md` were not part of this milestone’s changes.
