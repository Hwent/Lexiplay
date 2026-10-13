# Deploy LexiPlay on Render

This setup serves the React build and NestJS API from one HTTPS origin and uses managed PostgreSQL. It preserves the existing modules and cookie-based sign-in. The following configuration is for a **temporary free demo**, selected on 2026-10-12. This is an operator setup/release guide, not a current live-status report. See the dated validation record linked below for historical deployment evidence.

Render’s [free service limits](https://render.com/docs/free) include sleeping after 15 minutes of inactivity, no service shell, and a free PostgreSQL database that expires after 30 days. Free PostgreSQL has no backups. Choose a paid database and arrange backups before keeping real users’ progress long term. Confirm the current plan shown in the dashboard before creating a resource.

## 1. Create PostgreSQL

Open the [Render dashboard](https://dashboard.render.com), sign in, then choose **+ New → Postgres**. Name it `lexiplay-demo-db`. Select PostgreSQL 17 if available, choose a region, and select the Free plan. Leave generated credentials in place. Create the database and wait for Available.

On its Info page, find the **Internal Database URL** and **External Database URL**. These contain passwords. Keep them out of chat, screenshots, Git, and the browser frontend. The web service uses the internal URL; your local first-import command uses the external URL. The database and service must use the same region for [internal connections](https://render.com/docs/postgresql-creating-connecting).

To prepare the initial import, create the gitignored root `.env.deploy` on your computer containing this line with the external URL:

```dotenv
SEED_DATABASE_URL=postgresql://<user>:<password>@<external-host>/<database>
```

Do not replace your development `.env`. Restrict external database access to your public IP in Render’s networking settings where possible; external connections use TLS. After the import succeeds, remove external access if you no longer need local administration.

## 2. Prepare the email sender

For this no-domain demo, use `LexiPlay <onboarding@resend.dev>` as `MAIL_FROM`. Reuse your existing Resend key by copying it directly from your private local `.env` into Render’s environment settings. Alternatively, create a sending key in [Resend API Keys](https://resend.com/api-keys). Never put it in client build variables or paste it into chat.

The onboarding sender works only for the email associated with your Resend account. Other recipients require a domain you own, verified in [Resend Domains](https://resend.com/domains), and a sender on that domain. See the [onboarding restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain) and [verified-domain guide](https://resend.com/docs/dashboard/domains/introduction). Email and verification remain optional at signup, but recovery email delivery to general users is unavailable until the sender domain is configured.

## 3. Create the web service

In Render, choose **+ New → Web Service**, connect GitHub, and select `Hwent/Lexiplay`. Grant access to this repository. Use these settings:

| Setting | Value |
| --- | --- |
| Name | `lexiplay-demo` or another available name |
| Branch | `main` |
| Region | Same as the database |
| Runtime/language | Node |
| Root Directory | Leave blank; use repository root |
| Build Command | `corepack pnpm@11.25.0 install --frozen-lockfile --prod=false && corepack pnpm@11.25.0 --recursive --if-present build` |
| Start Command | `node apps/api/dist/main.js` |
| Instance Type | Free |
| Health Check Path | `/api/v1/health` |
| Auto-Deploy | Off for this initial walkthrough; deploy future commits manually |

Add the environment variables below in Render before deployment:

| Variable | Value | Private? |
| --- | --- | --- |
| `NODE_VERSION` | `22` | No |
| `NODE_ENV` | `production` | No |
| `HOST` | `0.0.0.0` | No |
| `SERVE_WEB` | `true` | No |
| `TRUST_PROXY_HOPS` | `1` for the service proxy; recheck client-IP behavior if adding another proxy | No |
| `DATABASE_URL` | Internal Database URL from stage 1 | Yes |
| `MAIL_MODE` | `resend` | No |
| `MAIL_FROM` | `LexiPlay <onboarding@resend.dev>` for this demo | No |
| `RESEND_API_KEY` | Your sending key | Yes |

Leave `PORT` unset; [Render supplies it](https://render.com/docs/web-services). Leave `PUBLIC_WEB_ORIGIN` unset for the generated Render domain: the app uses [`RENDER_EXTERNAL_URL`](https://render.com/docs/environment-variables). For a future custom domain, set `PUBLIC_WEB_ORIGIN=https://your-domain.example` and redeploy.

The repository's `.node-version` pins Node 22 when `NODE_VERSION` is unset. Render gives the environment variable priority over that file; see [runtime version selection](https://render.com/docs/node-version). The build command invokes the pinned pnpm version directly through Corepack and avoids global shim installation. Do not add `corepack enable`: Render's system binary directory can be read-only, causing `EROFS` before dependency installation. Corepack documents [direct invocation and its read-only filesystem workaround](https://github.com/nodejs/corepack#corepack-enable--name).

Review the settings and selected plan, then click **Deploy Web Service**. This is the point where you publish the demo. Watch build and runtime logs. The API binds `0.0.0.0`, validates production settings, and serves `apps/web/dist`; Vite is not used as a production server. HTTPS is handled by Render. The health endpoint confirms HTTP startup, not database connectivity or dictionary readiness.

## 4. Import the dictionary once

Free services have no shell, so run the first import from your local PowerShell terminal after stage 1. It may also run while the web service is building. The URL must identify the new Render database, not your local development database.

```powershell
cd C:\Users\William\Desktop\LexiPlay
pnpm build
node --env-file=.env.deploy scripts/seed-deployed.mjs
```

The wrapper asks you to type `SEED` before connecting/writing, uses verified TLS, and skips the first import if the dictionary already contains entries. It does not automatically run during builds, starts, or redeploys. Keep the terminal open while Simple English Wiktionary imports; wait for the loaded-entry count. Existing dictionary rows are preserved if the import fails. Accounts, personal words, and games are not imported from your local database.

After success, restrict/disable external database access again and keep `.env.deploy` private. Repository schemas are still initialized lazily on first feature access; standalone versioned migrations remain future work. The importer’s source attribution and license notice remain in the repo and `/licenses`.

## 5. Check the deployed demo

Open the exact HTTPS address shown by Render. Cold startup can take time on the Free plan. Complete these checks yourself:

1. `/api/v1/health` returns `{"status":"ok"}`; `/account` and `/games` load directly after refresh. A missing `/api/v1/...` path must return an API 404, not the website HTML.
2. As a guest, play a puzzle, use a hint, and save a word. Register without email, then confirm the puzzle/word transfer and that accepted guesses survive refresh.
3. Finish a game and check Statistics. Sign out and back in; confirm the saved words remain.
4. Use your own Resend account email for optional verification and recovery. Received links must open the deployed HTTPS `/account` page. Do not publish access tokens in screenshots or logs.
5. In browser developer tools, confirm the session cookie is HttpOnly, Secure, SameSite=Lax, and scoped to `/api/v1`. Check login throttling from different clients before a lasting public launch; proxy configuration is deployment-specific.

A local `localhost` or `127.0.0.1` word list cannot automatically move to the Render browser origin. The new public site has its own cookies/storage. Local accounts and saved games are not copied to Render by this procedure; a separate reviewed migration would be needed.

## Troubleshooting and limits

- **Build tool/version error:** check `NODE_VERSION=22` (or the repository's `.node-version`), the pinned Corepack/pnpm command, repository-root setting, and `--prod=false` so TypeScript/Vite are installed for the build. If the log reports `EROFS` for `/usr/bin/pnpm`, replace the old command with the direct Corepack command above.
- **No port detected:** use the compiled start command with `NODE_ENV=production` and `HOST=0.0.0.0`; use Render’s `PORT`.
- **Startup configuration error:** check the named environment variable in Render. The app does not print its private value.
- **Games cannot start:** confirm the first import completed against the correct database; an HTTP health success alone does not establish that.
- **Database connection fails:** use the internal URL in the service and the external URL only for local administration; ensure matching regions and your IP is allowed for the local import.
- **Verification/recovery message missing:** onboarding can send only to the Resend account email; check provider status and the deployed origin. A verified domain is required for other recipients.
- **Rollback:** with Auto-Deploy off, use Render’s Manual Deploy controls to select an earlier working commit. Take a database backup before schema-changing releases; a code rollback does not undo database changes.

This guide describes the demo setup procedure. The completed 2026-10-12 import and live checks are recorded in [deployment checks](archive/DEPLOYMENT-CHECKS-2026-10-12.md), including cleanup and remaining limits. Before a lasting launch, replace the expiring database, set up backups/restore, configure a verified sender, and define the public privacy/retention policy.

Database backup, recovery, refresh, and parallel-environment procedures are maintained in the [database manual](DATABASE-MANUAL.md).
