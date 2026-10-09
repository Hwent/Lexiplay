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

The launcher starts the NestJS API and Vite web app on available localhost ports and prints the web URL. Players can create an account, sign in, or play as a guest; account sessions and each learner’s single “My words” list persist in PostgreSQL. Start the local database with `docker compose up -d database`, then load LexiPlay’s database dictionary with `pnpm --filter @lexiplay/api dictionary:seed`. Simple English Wiktionary supplies the initial definitions; the stored dictionary is the standard for search, game answers, and accepted guesses. The dictionary supports add-to-list; new words start as unfamiliar. Word-list uploads accept TXT, DOCX, CSV, XLSX, and text-based PDF files, with a preview before confirmation. Players can choose 3–8 letter games and enter guesses one letter at a time. Game words must contain only lowercase English letters and have a stored definition. Active practice games are held in API memory, so restarting the API clears them.

Run the checks with `pnpm test`, `pnpm typecheck`, and `pnpm build`. Tests cover the account and word-list UI, auth and owned-list HTTP lifecycles, browser practice, the versioned health endpoint, and dictionary-backed games at all supported lengths using deterministic repository fixtures. See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for boundaries and conventions.

## GitHub

The remote is `https://github.com/Hwent/Lexiplay.git`. The `main` branch contains the initial scaffold. Push future work with:

```powershell
git push -u origin main
```
