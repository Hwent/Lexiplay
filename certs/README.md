# Azure PostgreSQL TLS

`azure-roots.pem` contains the public Microsoft RSA Root CA 2017 and DigiCert Global Root G2 certificates downloaded on 2026-11-03. It contains no private keys.

Use `sslmode=verify-full&sslrootcert=<absolute-path>/certs/azure-roots.pem` in `DATABASE_URL`. The file must exist in both the API and Prisma migration environments. URL-encode credentials and the certificate path as needed.

On Render's standard native runtime checkout, the absolute certificate path is `/opt/render/project/src/certs/azure-roots.pem`; verify the service root directory before cutover.

Update this bundle when Azure changes its required root CAs. Keep certificate and hostname verification enabled.

Source: https://learn.microsoft.com/en-us/azure/postgresql/security/security-tls-how-to-connect
