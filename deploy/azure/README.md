# Canada Central application deployment

Provisioned on 2026-11-04: App Service plan `lexiplay-ca-b1`, Linux B1, one instance in `canadacentral`, and Web App `lexiplay-ca-api-20261104` in resource group `Database`. Always On is enabled. The existing PostgreSQL server and database stay unchanged. Production traffic is still served by Render pending database access approval and verification.

Candidate origin: `https://lexiplay-ca-api-20261104-drhmefb7d4dafee7.canadacentral-01.azurewebsites.net`.

Confirmed retail compute price on 2026-11-04: USD 0.018/hour, or USD 13.14 / CAD 18.47 per 730 hours, before tax and egress. No resource is created by the release build.

Source: [Azure retail prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices). The user approved this recurring resource before creation. During validation, Render remains available and its existing charges continue.

The current API is in Render Oregon; warm database round trips to Canada Central measured about 76–80 ms. A game write still needs several sequential round trips even after the query reductions. Hosting the application alongside the database removes that cross-region leg; the actual interaction budgets must be measured again after deployment.

Build an archive of the reviewed commit, then run `build-release.sh` in `node:22-bookworm-slim` with `zip`, `openssl`, and CA certificates installed. Mount only the source archive and an output directory. This produces a Linux deployment ZIP with production dependencies and no environment files.

Runtime settings (health-check activation is tracked separately from provisioning):

```text
Runtime: Node 22 LTS, Linux
Startup: node apps/api/dist/main.js
Always On: true
Health check: /api/v1/health
HOST=0.0.0.0
PORT=8080
NODE_ENV=production
SERVE_WEB=true
TRUST_PROXY_HOPS=1
SCM_DO_BUILD_DURING_DEPLOYMENT=false
```

`PUBLIC_WEB_ORIGIN` initially uses the candidate origin. Copy the existing database and mail settings into App Service only after approval. The database URL must retain `sslmode=verify-full` and use `sslrootcert=/home/site/wwwroot/certs/azure-roots.pem`. Add only the 25 current IPv4 addresses from the resource's `outboundIpAddresses` field after approval. The networking summary shows 43 possible addresses, including other compute tiers; do not use that broader pool or enable access from all Azure services. These outbound addresses are shared Azure infrastructure, not dedicated addresses.

Deploy the ZIP with Microsoft Entra authentication using Kudu's **Deployments** page and **Skip Server-Side Build (Pre Built App)**. The portal's embedded file chooser did not open; the top-level Kudu page accepted the package. The tenant blocked the local CLI device-code login, so that flow was stopped without changing tenant policy. [Microsoft's ZIP deployment announcement](https://techcommunity.microsoft.com/blog/appsonazureblog/a-simpler-way-to-deploy-zip-packages-to-azure-app-service-from-the-azure-portal/4545430) describes the new UI.

Verify real database SSL, API timings, account/game recovery and transaction correctness before moving the custom domain. Keep Render available for rollback during verification. No database migration is required by these performance changes, and bulk data writes remain local.

Release validation: the `d19329b` Linux ZIP started against the local test database and passed health, database revision, SPA and immutable-asset checks. Kudu accepted deployment `adda2866-7bbc-416f-aa0e-2b3e7925a850`. Production database/mail credentials and firewall changes are awaiting explicit access approval; the new application is not yet production-ready, and the domain has not been switched.

`?measure=1` enables browser interaction diagnostics for the current tab; `?measure=0` disables them. Diagnostics record event-to-ready paint opportunities and request durations in the root DOM attribute `data-interaction-metrics`. They do not contain credentials, request bodies or query strings. Compare these separately from automation wall time.
