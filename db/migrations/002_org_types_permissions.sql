-- =============================================================================
-- MIGRATION 002 — Org Types, Permissions, Role Permissions, User/WorkItem updates
-- Run once against an existing database.
-- Safe to re-run — uses IF NOT EXISTS / IF EXISTS guards throughout.
-- =============================================================================

-- =============================================================================
-- 1. ORG TYPES LOOKUP TABLE
-- Replaces hardcoded org_type enum in organizations table.
-- org_type TEXT column stays as-is — validated at app layer against this table.
-- =============================================================================

CREATE TABLE IF NOT EXISTS blueprint.org_types (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,
    description TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 2. PERMISSIONS TABLE
-- Fixed vocabulary of system capabilities.
-- Seeded by system — not user-created. Each slug maps to a code check.
-- scope: 'system' | 'org' | 'work' | 'read'
-- =============================================================================

CREATE TABLE IF NOT EXISTS blueprint.permissions (
    id          SERIAL PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    description TEXT,
    scope       TEXT NOT NULL,
    category    TEXT NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_permissions_scope    ON blueprint.permissions(scope);
CREATE INDEX IF NOT EXISTS idx_permissions_category ON blueprint.permissions(category);

-- =============================================================================
-- 3. ROLE PERMISSIONS TABLE
-- Maps roles to permissions.
-- org_id NULL  = global default for this role (set by system admin)
-- org_id set   = org-level override (set by org admin for their org)
-- granted TRUE = permission is on; FALSE = explicitly revoked
--
-- Lookup order: org-specific override first, fall back to global default.
-- =============================================================================

CREATE TABLE IF NOT EXISTS blueprint.role_permissions (
    id            SERIAL PRIMARY KEY,
    role_id       INTEGER NOT NULL REFERENCES blueprint.roles(id),
    permission_id INTEGER NOT NULL REFERENCES blueprint.permissions(id),
    org_id        INTEGER REFERENCES blueprint.organizations(id),
    granted       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Two partial unique indexes to handle the nullable org_id correctly:
-- Global defaults (org_id IS NULL): one entry per role+permission
-- Org overrides (org_id set): one entry per role+permission+org

CREATE UNIQUE INDEX IF NOT EXISTS idx_rp_global
    ON blueprint.role_permissions(role_id, permission_id)
    WHERE org_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rp_org_override
    ON blueprint.role_permissions(role_id, permission_id, org_id)
    WHERE org_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON blueprint.role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_perm ON blueprint.role_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_org  ON blueprint.role_permissions(org_id);

-- =============================================================================
-- 4. USERS — add stub auth and API token columns
-- =============================================================================

ALTER TABLE blueprint.users
    ADD COLUMN IF NOT EXISTS password_hash TEXT,
    ADD COLUMN IF NOT EXISTS api_token     TEXT UNIQUE;

-- =============================================================================
-- 5. WORK ITEMS — make owner_org_id nullable, add owner_user_id
-- Personal work items: owner_org_id NULL, owner_user_id set
-- Org work items:      owner_org_id set, owner_user_id NULL (or set if created by a user)
-- =============================================================================

ALTER TABLE runtime.work_items
    ALTER COLUMN owner_org_id DROP NOT NULL;

ALTER TABLE runtime.work_items
    ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES blueprint.users(id);

-- At least one owner must be set
ALTER TABLE runtime.work_items
    DROP CONSTRAINT IF EXISTS work_item_owner_check;
ALTER TABLE runtime.work_items
    ADD CONSTRAINT work_item_owner_check
    CHECK (owner_org_id IS NOT NULL OR owner_user_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_wi_owner_user
    ON runtime.work_items(owner_user_id)
    WHERE owner_user_id IS NOT NULL;

-- =============================================================================
-- END MIGRATION 002
-- =============================================================================
