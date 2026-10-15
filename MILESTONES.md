# LexiPlay milestones

Current version: **v0.1** (package version `0.1.0`). Status: **ready for release**.

This records the implemented v0.1 scope and the proposed roadmap. Readiness describes the product scope; deployment is a separate, deliberate step. Future versions have no committed dates.

## v0.1 — Completed product scope

- [x] Word puzzles with 3–9 letter options, difficulty selection, keyboard feedback, and continued practice.
- [x] Full-dictionary, CEFR A1–C2 and personal-word game pools; family-based vocabulary collections.
- [x] Dictionary definitions, browser pronunciation where supported, and saving game words to a personal list.
- [x] One My Word List per account, dictionary search, selected-word imports, pagination, familiarity and simple review scheduling.
- [x] Import pasted words and TXT/CSV word files; supplied definitions are ignored and additions require dictionary matches.
- [x] Separate account/guest coin balances, one-coin game entry, win rewards and maintenance refunds to the original payer.
- [x] Canonical dictionary/POS identities, normalized game persistence, explicit foreign keys, and schema changes through Prisma migrations.
- [x] Guest practice and local word lists, with progress transfer to an account after sign-in.
- [x] Username/password registration, sign-in/out, optional recovery email and verification, password reset, and account deletion.
- [x] Learning statistics, winning-guess distribution, and recent completed games for signed-in learners.
- [x] Responsive navigation, light/dark appearance, and dictionary attribution.
- [x] PostgreSQL persistence and a production build serving the web app and API from one origin.
- [x] Home page release summary and creator GitHub profile link.

### Current limits

- Community is a placeholder; sharing and community challenges are planned.
- The game catalog currently contains one playable mode: Word puzzle.
- Pronunciation depends on browser speech support. Recovery emails require the deployment's mail configuration.
- Statistics are available to signed-in learners. CEFR collections are learning selections, not proficiency certification; IELTS and TOEFL collections are unavailable.

## v0.2 — Review habit (planned)

- [ ] Automated spaced repetition beyond the current review controls.
- [ ] Daily practice goals.
- [ ] Clearer progress trends across practice sessions.

## v0.3 — Community (planned)

- [ ] Opt-in sharing of word lists.
- [ ] Community challenges.

## Later — More ways to practise (proposed)

- [ ] Additional game modes.
- [ ] Personalized practice recommendations.
- [ ] Broader language support.

Priorities may change with learner feedback. Planned features are not included in v0.1.

## Release verification

Before deployment, require the release commit's CI to pass `pnpm test`, `pnpm typecheck`, and `pnpm build`. Confirm the production dictionary, database, and mail configuration, then smoke-test guest play, sign-in, word-list imports, and Statistics. The local operational guides under ignored `docs/` remain the source for environment-specific deployment procedures.
