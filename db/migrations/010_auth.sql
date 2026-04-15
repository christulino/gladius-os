-- Migration 010: Authentication
-- Adds password hash to users, session store table, and setup tracking

-- Password hash on users (nullable — existing users need to set a password)
ALTER TABLE blueprint.users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Track whether initial setup is complete
ALTER TABLE blueprint.users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Session store for connect-pg-simple
CREATE TABLE IF NOT EXISTS runtime.sessions (
    sid    VARCHAR NOT NULL PRIMARY KEY,
    sess   JSONB NOT NULL,
    expire TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expire ON runtime.sessions (expire);
