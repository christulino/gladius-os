-- db/migrations/027_hash_api_tokens.sql
-- Hash API tokens at rest (DEBT.26612).
--
-- Problem: core/auth.js#findUserByApiToken looked up blueprint.users by
-- plaintext api_token via a direct SQL equality (WHERE api_token = $1).
-- That leaves usable agent credentials readable in the DB at rest, and the
-- equality compare isn't timing-safe.
--
-- Fix: store a deterministic SHA-256 hash of the token in a new
-- api_token_hash column and look up by that hash (indexed, O(1)). Because
-- API tokens are high-entropy random values (fos_ak_ prefix), an unsalted
-- SHA-256 is appropriate here (GitHub PAT model) — bcrypt's per-row salt
-- would make lookup-by-hash impossible. This resolves the plaintext-at-rest
-- and timing concerns.
--
-- Scope note: the plaintext api_token column is intentionally KEPT for now.
-- The verify path retains a plaintext fallback + hash-on-use backfill so no
-- token breaks. Dropping the plaintext column is a deliberate follow-up
-- (not this migration), gated on the hash path being confirmed in production.
--
-- Idempotent: safe to re-run. Column/index use IF NOT EXISTS; the backfill
-- only touches rows whose hash is still NULL.

-- pgcrypto provides digest() for the in-SQL SHA-256 backfill. It is already
-- installed on existing deployments; CREATE ... IF NOT EXISTS is defensive
-- so a fresh DB is self-sufficient.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- 1. Add the hash column
-- =============================================================================

ALTER TABLE blueprint.users
    ADD COLUMN IF NOT EXISTS api_token_hash TEXT;

-- =============================================================================
-- 2. Unique index on the hash (partial — only non-NULL hashes must be unique)
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_api_token_hash
    ON blueprint.users (api_token_hash)
    WHERE api_token_hash IS NOT NULL;

-- =============================================================================
-- 3. Backfill existing plaintext tokens -> hex SHA-256 hash
-- =============================================================================

UPDATE blueprint.users
    SET api_token_hash = encode(digest(api_token, 'sha256'), 'hex')
    WHERE api_token IS NOT NULL
      AND api_token_hash IS NULL;
