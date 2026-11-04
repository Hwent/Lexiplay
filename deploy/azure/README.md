# Canada Central deployment candidate

Proposed host: Azure App Service, Linux B1, one instance in `canadacentral`, Always On enabled. The existing PostgreSQL server and database stay unchanged.

Confirmed retail compute price on 2026-11-04: USD 0.018/hour, or USD 13.14 / CAD 18.47 per 730 hours, before tax and egress. No resource is created by the release build.

Source: [Azure retail prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices). During validation, Render remains available and its existing charges continue. Creating this recurring resource requires the user's approval.

The current API is in Render Oregon; warm database round trips to Canada Central measured about 76–80 ms. A game write still needs several sequential round trips even after the query reductions. Hosting the application alongside the database removes that cross-region leg; the actual interaction budgets must be measured again after deployment.

Build an archive of the reviewed commit, then run `build-release.sh` in `node:22-bookworm-slim` with `zip`, `openssl`, and CA certificates installed. Mount only the source archive and an output directory. This produces a Linux deployment ZIP with production dependencies and no environment files.

App Service settings:

```text
Runtime: Node 22 LTS, Linux
Startup: node apps/api/dist/main.js
Always On: true
Health check: /api/v1/health
HOST=0.0.0.0
NODE_ENV=production
SERVE_WEB=true
TRUST_PROXY_HOPS=1
SCM_DO_BUILD_DURING_DEPLOYMENT=false
```

Set `PUBLIC_WEB_ORIGIN` to the reviewed app origin. Copy the existing database and mail settings into App Service only after approval. The database URL must retain `sslmode=verify-full` and use `sslrootcert=/home/site/wwwroot/certs/azure-roots.pem`. Add only the new app's identified outbound addresses to the database firewall after approval; do not enable access from all Azure services.

Deploy the ZIP with Microsoft Entra authentication (`az webapp deploy`), then verify real database SSL, API timings, account/game recovery and transaction correctness before moving the custom domain. Keep Render available for rollback during verification. No database migration is required by these performance changes.

Release validation: start the extracted ZIP in the same Node 22 Linux image against a local test database, then check `/api/v1/health`, `/api/v1/library/revision`, SPA routes, and immutable hashed assets. This passed for the initial candidate at `7f135f4`; rebuild and repeat for the final deployed commit. Deployment and domain switching have not happened.

`?measure=1` enables browser interaction diagnostics for the current tab; `?measure=0` disables them. Diagnostics record event-to-ready paint opportunities and request durations in the root DOM attribute `data-interaction-metrics`. They do not contain credentials, request bodies or query strings. Compare these separately from automation wall time.
