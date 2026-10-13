# Games, Statistics, and accounts

Current implementation, updated 2026-10-13. This document describes shipped behavior. Use the [documentation index](README.md) for operations/design guides; earlier validation records are in [implementation milestones](archive/IMPLEMENTATION-MILESTONES.md). The missed-word review queue remains future work.

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

The start page explains Wordle-style feedback and offers All words, Primary school, Grade 12, IELTS, and grouped CEFR ranges. These are curated practice categories, not certified word-level assessments; availability comes from the live dictionary. The chosen range restricts answers and is saved with the game, while other dictionary words remain valid guesses. Personal-word mode also intersects the chosen range. The play page shows a small range label, automatically submits a full-length guess, and displays invalid-word feedback above the centered grid with an animation. Speaker buttons use browser speech synthesis when available.

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
| `POST /games` | `{ kind?, wordLength?, difficulty?, playWithMyWords?, vocabularyRange? }`; create owned game |
| `GET /games/vocabulary-ranges` | Available categories and playable answer counts by length |
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

`pnpm dev` always forces local preview mode, even if `.env` says `MAIL_MODE=resend`. Use the [Deployment guide](DEPLOYMENT.md#2-prepare-the-email-sender) for real sender setup and a deliberate delivery test against the configured deployed service. The [onboarding sender can deliver only to the Resend account email](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain); other recipients need a verified domain.

Local links work only on the computer running LexiPlay, while that dev server is active. Inbox receipt, successful link consumption, and provider acceptance are separate checks; a local preview is not evidence of Gmail delivery. Never paste the API key or verification token into chat or commit them.

## Verification and remaining limits

Run `pnpm test`, `pnpm typecheck`, and `pnpm build`. Ordinary tests use deterministic adapters and mocked mail. For real PostgreSQL tests, point `TEST_DATABASE_URL` at a **separate disposable database named `lexiplay_test_*`**. The integration suite refuses other database names. GitHub CI provisions its own PostgreSQL service and runs these checks.

Real-database coverage includes API restart, concurrent guesses, ownership, persisted Statistics, optional recovery email, verification, expired/single-use links, session revocation, and account deletion with cleanup and owner isolation. UI tests cover nine-letter difficulty controls, hints, resume, Statistics, signup without email, verification opt-in, password visibility, recovery, and deletion confirmation/failure/success.

Repositories still apply schema changes lazily; standalone versioned migrations remain future work. Statistics calculates all-time metrics from completed games and displays only the latest 20; history pagination and SQL aggregation are future scaling work. A missed-word review queue, account export, and changing/removing an existing recovery email are not implemented. Render deployment is documented and has historical validation; automated backup scheduling and retention remain operator responsibilities described in the [database manual](DATABASE-MANUAL.md).
