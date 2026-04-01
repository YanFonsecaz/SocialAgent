#!/usr/bin/env sh

set -eu

run_migrations="${RUN_MIGRATIONS:-true}"

if [ "$run_migrations" = "true" ] || [ "$run_migrations" = "1" ]; then
  echo "[Startup] Running database migrations..."
  bun run db:migrate
else
  echo "[Startup] Skipping database migrations (RUN_MIGRATIONS=$run_migrations)."
fi

echo "[Startup] Starting SocialAgent..."
exec bun dist/server.js
