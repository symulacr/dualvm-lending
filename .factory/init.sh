#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== Installing dependencies ==="
cd dualvm
npm ci

echo "=== Running tests ==="
npm test

echo "=== TypeScript typecheck ==="
npx tsc --noEmit

echo "=== Building ==="
npm run build

echo "=== Init complete ==="
