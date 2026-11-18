#!/usr/bin/env bash
# The full gate: formatting, build and type checks, architecture boundaries and their negative
# fixtures, every package's behaviour tests, an independent consumer, and a production build.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then npm ci --no-audit --no-fund; fi
npx prettier --check .
npx tsc -b
npx tsc -p tsconfig.tests.json
node tool/check_boundaries.mjs
npx vitest run
node tool/verify_consumer.mjs
npm run build --workspace example
echo "All checks passed."
