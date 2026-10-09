# LexiPlay

LexiPlay is a vocabulary practice game. Product requirements and the initial architecture live in [`outputs/docs/PRD.md`](outputs/docs/PRD.md) and [`outputs/docs/TECHNICAL_DESIGN.md`](outputs/docs/TECHNICAL_DESIGN.md).

## Repository structure

- `apps/web` — browser experience (React)
- `apps/api` — HTTP API and application services (NestJS)
- `packages/shared` — versioned API contracts shared by the apps; domain rules remain in the API
- `outputs/docs` — product and technical design source documents

Keep modules cohesive, expose behavior through narrow interfaces, and place automated checks next to the component they protect. Add cross-component flows in dedicated integration or end-to-end suites as those features arrive.

## Development status

This repository contains the initial structure and product docs. The web and API entry points are placeholders until the framework dependencies and database migrations are added. Prerequisites for implementation are Node.js 22+, pnpm, and Docker Desktop for PostgreSQL. See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for component boundaries and conventions.

## GitHub

Create a private repository named `LexiPlay` in your GitHub account, without adding a README, license, or gitignore (this directory already contains the initial files). Then connect and push:

```powershell
git remote add origin https://github.com/OWNER/LexiPlay.git
git push -u origin main
```

Replace `OWNER` with your GitHub username or organization. Enable Actions and branch protection after the first push.
