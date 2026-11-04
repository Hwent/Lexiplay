# Canada Central application deployment

Provisioned on 2026-11-04: App Service plan `lexiplay-ca-b1`, Linux B1, one instance in `canadacentral`, and Web App `lexiplay-ca-api-20261104` in resource group `Database`. Always On is enabled. The existing PostgreSQL server and database stay unchanged. Production traffic is still served by Render pending connection configuration and verification. The user approved the database firewall and credential configuration.

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
SCM_DO_BUILD_DURING_DEPLOYMENT=true
ENABLE_ORYX_BUILD=true
NODE_VERSION=22
CUSTOM_BUILD_COMMAND=corepack pnpm@11.25.0 install --frozen-lockfile --prod=false && corepack pnpm@11.25.0 --recursive --if-present build
```

`PUBLIC_WEB_ORIGIN` initially uses the candidate origin. Copy the existing database and mail settings into App Service only after approval. The database URL must retain `sslmode=verify-full` and use `sslrootcert=/home/site/wwwroot/certs/azure-roots.pem`. Add only the 25 current IPv4 addresses from the resource's `outboundIpAddresses` field after approval. The networking summary shows 43 possible addresses, including other compute tiers; do not use that broader pool or enable access from all Azure services. These outbound addresses are shared Azure infrastructure, not dedicated addresses.

The 1.2 MB source archive from `git archive d19329b` built successfully in App Service using the settings above (deployment `6181813c-e2dc-4a5d-a1b3-04b29c6c1de6`). Configure settings before publishing: changing app settings restarts the publishing container and interrupted the first prebuilt-package deployment. The tenant blocked local CLI device-code login; no tenant policy was changed.

## GitHub automatic deployment

The workflow `.github/workflows/azure-deploy.yml` is prepared for pushes to `Nov-2026` and manual runs from that branch. It packages only Git-tracked files, signs in with OpenID Connect, and deploys the source archive for the server's pnpm build. Deployments are serialized rather than cancelling an in-progress publication.

Connection is pending GitHub authorization and Azure identity configuration. Set repository variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and `AZURE_SUBSCRIPTION_ID` after creating the deployment identity. Keep database and mail credentials exclusively in App Service settings.

Use a user-assigned identity with **Website Contributor** scoped only to this Web App. The federated credential must trust issuer `https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange`, and subject `repo:Hwent/Lexiplay:ref:refs/heads/Nov-2026`. The workflow has no GitHub environment that would change this subject. Do not enable basic publishing authentication.

Verify real database SSL, API timings, account/game recovery and transaction correctness before moving the custom domain. Keep Render available for rollback during verification. No database migration is required by these performance changes, and bulk data writes remain local.

Release validation: the `d19329b` Linux ZIP started against the local test database and passed health, database revision, SPA and immutable-asset checks. The source-based Azure build also succeeded. Production database/mail credentials and firewall changes are approved but not yet applied; the new application is not yet production-ready, and the domain has not been switched.

`?measure=1` enables browser interaction diagnostics for the current tab; `?measure=0` disables them. Diagnostics record event-to-ready paint opportunities and request durations in the root DOM attribute `data-interaction-metrics`. They do not contain credentials, request bodies or query strings. Compare these separately from automation wall time.
