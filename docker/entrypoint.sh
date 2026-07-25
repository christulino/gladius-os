#!/bin/sh
# docker/entrypoint.sh — first-boot bootstrap for the Gladius app container.
# Runs on every `docker compose up`. Idempotent.
set -e

SECRETS_FILE="/data/secrets.env"
mkdir -p /data

# ── 1. Wait for Postgres (belt-and-suspenders on top of compose service_healthy).
echo "[entrypoint] Waiting for PostgreSQL at ${POSTGRES_HOST:-localhost}:${POSTGRES_PORT:-5432}..."
i=0
until node -e "const pg=require('pg');const c=new pg.Client({host:process.env.POSTGRES_HOST,port:process.env.POSTGRES_PORT,database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD});c.connect().then(()=>c.end()).then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "[entrypoint] PostgreSQL never became ready (30 attempts) — exiting." >&2
    exit 1
  fi
  sleep 2
done
echo "[entrypoint] PostgreSQL is ready."

# ── 2. Load persisted secrets, generating any that are still missing.
if [ -f "$SECRETS_FILE" ]; then
  set -a
  . "$SECRETS_FILE"
  set +a
fi
if [ -z "$SESSION_SECRET" ] || [ -z "$GLADIUS_ENCRYPTION_KEY" ]; then
  echo "[entrypoint] Generating missing secrets (first boot)..."
  if [ -z "$SESSION_SECRET" ]; then
    SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
    export SESSION_SECRET
  fi
  if [ -z "$GLADIUS_ENCRYPTION_KEY" ]; then
    GLADIUS_ENCRYPTION_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
    export GLADIUS_ENCRYPTION_KEY
  fi
  {
    echo "SESSION_SECRET=${SESSION_SECRET}"
    echo "GLADIUS_ENCRYPTION_KEY=${GLADIUS_ENCRYPTION_KEY}"
  } > "$SECRETS_FILE"
  chmod 600 "$SECRETS_FILE"
  echo "[entrypoint] Secrets persisted to ${SECRETS_FILE} (on the gladius_data volume)."
fi

# ── 3. Apply base schema (fresh DB only), then migrate + seed.
echo "[entrypoint] Applying base schema (if needed)..."
node db/applyBaseSchema.js

echo "[entrypoint] Running migrations + solo seed..."
node db/seeds/seed-solo.js

# ── 4. Launch the API server as PID 1.
echo "[entrypoint] Starting Gladius API on :${PORT:-3000}..."
exec node api/server.js
