#!/usr/bin/env bash
set -euo pipefail

# Run inside the official Node 22 Linux image with only a git archive and an output directory mounted.
archive="${1:?Source git archive required}"
output="${2:?Output directory required}"
mkdir -p /tmp/lexiplay-build /tmp/lexiplay-release
tar -xf "$archive" -C /tmp/lexiplay-build
cd /tmp/lexiplay-build
printf '\nnodeLinker: hoisted\n' >> pnpm-workspace.yaml
corepack pnpm@11.25.0 install --frozen-lockfile --prod=false
corepack pnpm@11.25.0 --recursive --if-present build
corepack pnpm@11.25.0 --filter @lexiplay/api deploy --prod --legacy /tmp/lexiplay-release/apps/api
mkdir -p /tmp/lexiplay-release/apps/api/dist /tmp/lexiplay-release/apps/web /tmp/lexiplay-release/certs
cp -a apps/api/dist/. /tmp/lexiplay-release/apps/api/dist/
cp -a apps/web/dist /tmp/lexiplay-release/apps/web/
cp certs/azure-roots.pem /tmp/lexiplay-release/certs/
cd /tmp/lexiplay-release
node -e 'require("node:fs").writeFileSync("package.json",JSON.stringify({name:"lexiplay-release",private:true,scripts:{start:"node apps/api/dist/main.js"},engines:{node:"22.x"}})); require("node:fs").writeFileSync("release.json",JSON.stringify({commit:process.env.SOURCE_COMMIT,node:process.version}));'
node -e 'const {createRequire}=require("node:module");const r=createRequire(process.cwd()+"/apps/api/package.json"); for(const name of ["@nestjs/core","@prisma/adapter-pg","pg","pdf-parse"])r.resolve(name);'
if find . -name '.env' -o -name '.git' | grep -q .; then echo 'Unexpected private source files in release' >&2; exit 1; fi
zip -qr "$output/lexiplay-release.zip" .
cp release.json "$output/release.json"
echo "Release ready: $(du -h "$output/lexiplay-release.zip" | cut -f1)"
