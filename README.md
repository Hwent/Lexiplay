# LexiPlay

LexiPlay is a vocabulary practice game. Product requirements and the initial architecture live in [`outputs/docs/PRD.md`](outputs/docs/PRD.md) and [`outputs/docs/TECHNICAL_DESIGN.md`](outputs/docs/TECHNICAL_DESIGN.md).

## Repository structure

- `apps/web` — browser experience (React)
- `apps/api` — HTTP API and application services (NestJS)
- `packages/shared` — stable shared contracts and sourced vocabulary data
- `outputs/docs` — product and technical design source documents

Keep modules cohesive, expose behavior through narrow interfaces, and place automated checks next to the component they protect. Add cross-component flows in dedicated integration or end-to-end suites as those features arrive.

## Run locally

Prerequisites: Node.js 22+ and pnpm 11.25.0. The project pins the package manager and includes a lockfile.

```powershell
pnpm install
pnpm dev
```

The launcher starts the NestJS API and Vite web app on available localhost ports and prints the web URL. Start PostgreSQL with `docker compose up -d database`, then load the dictionary with `pnpm --filter @lexiplay/api dictionary:seed`. Players can register with a username and email, sign in using either, or play as guests. Passwords require at least eight characters. Account sessions, personal words, games, accepted guesses, and hints persist in PostgreSQL.

Games currently offers Word puzzle and can accommodate more games. Choose 3–9 letters and Easy (7 guesses, 3 uses of each hint), Medium (6 guesses, 2 uses), or Hard (5 guesses, 1 use). Puzzles restore after refresh or API restart. Statistics shows signed-in practice history, win rate, streak, and winning guess distribution. Dictionary words need lowercase English letters and a stored definition. Each learner has one “My words” list with Known/Unfamiliar status; imports support TXT, DOCX, CSV, XLSX, and text-based PDF with preview before confirmation.

Verification and password recovery use expiring email links. Development email previews are written to the gitignored `apps/api/.local-mail` directory; production delivery needs an HTTPS web origin, Resend key, and verified sender. See [games and accounts](docs/GAMES_AND_ACCOUNTS.md) for rules, API routes, email setup, and known limits.

Run the checks with `pnpm test`, `pnpm typecheck`, and `pnpm build`. Tests cover UI, account and owned-list lifecycles, and games at every supported length through the production validation pipeline. Set `TEST_DATABASE_URL` to a disposable `lexiplay_test_*` database to run persistence/restart/concurrency and account-link integration checks; CI supplies one automatically. See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for boundaries and conventions.

## GitHub

The remote is `https://github.com/Hwent/Lexiplay.git`. Push future work with:

```powershell
git push -u origin main
```
