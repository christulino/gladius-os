-- Migration 004: Org-level WIP limits, class-level field definitions, display keys
-- Applied: Session 6

-- =============================================================================
-- 1. Org-level WIP limits
-- WIP keyed on stage_name string — "stages with the same name = same stage on the board."
-- =============================================================================

CREATE TABLE IF NOT EXISTS blueprint.org_wip_limits (
    id               SERIAL PRIMARY KEY,
    org_id           INTEGER NOT NULL REFERENCES blueprint.organizations(id),
    stage_name       TEXT NOT NULL,
    wip_limit        INTEGER NOT NULL CHECK (wip_limit > 0),
    enforcement_type TEXT NOT NULL DEFAULT 'soft' CHECK (enforcement_type IN ('soft', 'hard')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, stage_name)
);

-- =============================================================================
-- 2. Class-level field definitions
-- Fields defined at class level, copied to type fields on type creation
-- =============================================================================

CREATE TABLE IF NOT EXISTS blueprint.work_item_class_fields (
    id            SERIAL PRIMARY KEY,
    class_id      INTEGER NOT NULL REFERENCES blueprint.work_item_type_classes(id),
    field_key     TEXT NOT NULL,
    field_label   TEXT NOT NULL,
    field_type    TEXT NOT NULL,  -- text|number|date|boolean|select|multiselect|url|user|currency
    field_options JSONB,
    field_group   TEXT,
    is_required   BOOLEAN NOT NULL DEFAULT FALSE,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (class_id, field_key)
);

-- =============================================================================
-- 3. Work item display key support
-- Human-readable key like DT.101 (type prefix + sequence number)
-- =============================================================================

-- Add key_prefix to work item types (e.g. "TSK", "BUG", "SR")
ALTER TABLE blueprint.work_item_types
  ADD COLUMN IF NOT EXISTS key_prefix TEXT;

-- Add sequence number and display_key to work items
ALTER TABLE runtime.work_items
  ADD COLUMN IF NOT EXISTS sequence_number INTEGER;

ALTER TABLE runtime.work_items
  ADD COLUMN IF NOT EXISTS display_key TEXT;

-- Global sequence for work item numbering
CREATE SEQUENCE IF NOT EXISTS runtime.work_item_seq;

-- Index for fast lookup by display_key
CREATE INDEX IF NOT EXISTS idx_wi_display_key ON runtime.work_items(display_key);

-- Seed key_prefix for existing system-default types
UPDATE blueprint.work_item_types SET key_prefix = 'TSK' WHERE name = 'Task'            AND key_prefix IS NULL;
UPDATE blueprint.work_item_types SET key_prefix = 'FT'  WHERE name = 'Feature'         AND key_prefix IS NULL;
UPDATE blueprint.work_item_types SET key_prefix = 'BUG' WHERE name = 'Bug'             AND key_prefix IS NULL;
UPDATE blueprint.work_item_types SET key_prefix = 'EP'  WHERE name = 'Epic'            AND key_prefix IS NULL;
UPDATE blueprint.work_item_types SET key_prefix = 'PRJ' WHERE name = 'Project'         AND key_prefix IS NULL;
UPDATE blueprint.work_item_types SET key_prefix = 'SR'  WHERE name = 'Service Request' AND key_prefix IS NULL;
UPDATE blueprint.work_item_types SET key_prefix = 'INC' WHERE name = 'Incident'        AND key_prefix IS NULL;

-- Backfill display_key for any existing work items
UPDATE runtime.work_items wi
SET sequence_number = wi.id,
    display_key = (
      SELECT COALESCE(wit.key_prefix, 'WI') FROM blueprint.work_item_types wit WHERE wit.id = wi.work_item_type_id
    ) || '.' || wi.id
WHERE wi.display_key IS NULL;

-- Set sequence to max existing id
SELECT setval('runtime.work_item_seq', COALESCE((SELECT MAX(id) FROM runtime.work_items), 0));

-- =============================================================================
-- 4. Work item links table (for "related" links — parent/child uses parent_id)
-- =============================================================================

CREATE TABLE IF NOT EXISTS runtime.work_item_links (
    id                   SERIAL PRIMARY KEY,
    source_work_item_id  INTEGER NOT NULL REFERENCES runtime.work_items(id),
    target_work_item_id  INTEGER NOT NULL REFERENCES runtime.work_items(id),
    link_type            TEXT NOT NULL CHECK (link_type IN ('related', 'blocks', 'duplicates')),
    created_by_user_id   INTEGER,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_work_item_id, target_work_item_id, link_type)
);

CREATE INDEX IF NOT EXISTS idx_wil_source ON runtime.work_item_links(source_work_item_id);
CREATE INDEX IF NOT EXISTS idx_wil_target ON runtime.work_item_links(target_work_item_id);
