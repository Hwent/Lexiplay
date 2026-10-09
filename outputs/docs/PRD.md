# LexiPlay — Product Requirements

**Status:** Initial draft · **Version:** 0.1 · **Platform:** Responsive web app

## 1. Product summary

LexiPlay is a Wordle-inspired English vocabulary practice app. A player chooses a vocabulary list, guesses a hidden word using a limited number of attempts, and learns from the result through definitions and review. The first release should demonstrate a complete, dependable full-stack product suitable for a software portfolio.

## 2. Goals and non-goals

### MVP goals

- Deliver a polished, keyboard- and touch-friendly daily/practice word puzzle.
- Let a player create and manage private vocabulary lists, add words manually, and import a simple CSV file.
- Provide a small, clearly attributed starter vocabulary list shipped with the product.
- Save game results and basic progress for signed-in players.
- Show end-to-end engineering quality: documented API, relational persistence, automated checks, containerized local setup, and repeatable deployment.

### Out of scope for MVP

- Live multiplayer, matchmaking, public leaderboards, chat, friends, and social feeds.
- Mobile native apps, paid subscriptions, and user-contributed public catalogs.
- Large third-party dictionary integrations or arbitrary web scraping.
- Complex spaced-repetition scheduling. A simple missed-word review queue is sufficient.

## 3. Target users and primary value

English learners who want short, repeatable vocabulary practice, and portfolio reviewers evaluating product thinking and delivery. The app should make practice engaging while exposing useful learning context; success is not limited to solving the puzzle.

## 4. MVP scope and requirements

### P0 — required for launch

1. **Account:** register, sign in, sign out, and recover access through a secure identity flow. A guest may preview a sample puzzle; persistence and personal lists require an account.
2. **Vocabulary lists:** view starter lists, create/edit/delete owned lists, add/edit/remove words, and select a list for practice. Validate duplicate words, word length, supported characters, and list limits.
3. **Import:** upload CSV with a documented header (`word,definition,partOfSpeech,example`). Preview row-level errors and valid rows before import; cap file size and row count; never execute formulas or treat imported text as HTML.
4. **Puzzle:** show a fixed-length word grid, on-screen keyboard, focusable input, guess count, feedback colors plus non-color indicators, and accessible instructions. Normalize case and trim input. Reject words that are not eligible answers or guesses with a clear message.
5. **Learning result:** on win or loss, reveal the answer, definition and example when available; offer the next word and add missed words to a review queue.
6. **Progress:** show recent outcomes, streak, attempts distribution, and review items. Define streak by local calendar day and document timezone behavior.
7. **Responsive experience:** usable at mobile and desktop sizes, with loading, empty, validation, and error states.

### P1 — only if P0 is stable

- Export a user's list as CSV; search and filter lists; optional practice settings.
- Installable PWA shell and basic offline access to cached static assets (no offline sync requirement).

## 5. Core user flows

### First practice

Landing page → preview or register/sign in → choose a starter list → start puzzle → submit guesses → solve or exhaust attempts → see answer and learning details → review missed word or play again.

### Build a personal list

Sign in → vocabulary library → create list → add words manually or import CSV → review validation/preview → save → choose list → practice.

### Review progress

Sign in → dashboard → inspect recent games and streak → open missed-word queue → practice a selected list or retry due words.

## 6. Product rules and success measures

- Initial default: five-letter answers and six attempts; store these as game rules/configuration so later modes do not require a schema redesign.
- Guess validation and answer selection are server-authoritative. Do not return the answer in puzzle-start payloads.
- A game records its selected list, answer reference/snapshot, guesses, result, and timestamps. Retrying a finished game is a new game.
- Starter content must have a known license/source and attribution record before publication.
- Portfolio success measures: a new user can complete practice without guidance; list import surfaces actionable errors; game state survives refresh; CI and deployment can be demonstrated from repository instructions.
- Product signals to instrument (privacy-conscious): practice started/completed, list created/imported, and review opened. Do not collect guess text for analytics.

## 7. Acceptance criteria

- A user can register, sign in, and access only their own lists and history.
- A user can create a list, add valid words, import a valid CSV, and receive row-specific feedback for invalid CSV rows.
- A game selects an eligible answer from the chosen list; accepted guesses update feedback correctly; invalid guesses do not consume attempts; answer is revealed at completion.
- Game outcome and progress persist after refresh and are attributed to the correct user.
- Keyboard and touch input work; screen-reader labels and non-color feedback make the puzzle understandable without relying on color alone.
- API validation, authorization, and rate limits protect account and game endpoints; secrets are not present in the repository.
- A clean checkout can start locally with documented container commands; required checks pass in CI; a tagged/released build can be deployed with environment-specific configuration.

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Word list licensing or inconsistent definitions | Use a small curated source with documented license and attribution; keep content provenance in data. |
| Answer leakage undermines play | Keep answer selection and validation on server; avoid answer-bearing payloads before completion; do not expose raw solution tables publicly. |
| CSV parsing abuse or poor imports | Enforce MIME/size/row limits, parse as data, preview before commit, validate every row, and test malformed inputs. |
| Scope expands into social features | Treat multiplayer and rankings as a later milestone; freeze MVP around solo practice and learning feedback. |
| Account/privacy burden | Collect minimal profile data, provide deletion/export path, publish privacy and retention notes before public launch. |
| Portfolio deployment fragility | Use managed PostgreSQL, migrations, health checks, backups, and a documented rollback procedure. |
