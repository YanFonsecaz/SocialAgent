#!/usr/bin/env sh

set -eu

echo "[Startup] Running database migrations..."
bun run db:migrate

echo "[Startup] Starting SocialAgent..."
exec bun dist/server.js
