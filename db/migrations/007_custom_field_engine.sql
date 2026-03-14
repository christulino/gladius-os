-- Migration 007: Custom Field Engine
-- Lookup lists, extended field definitions, acceptance criteria
-- Applied: Session 12

-- =============================================================================
-- 1. Lookup Lists — named lists of selectable values
-- Two scopes: system (owned by system org, available everywhere)
--             org (owned by specific org, visible to that org + descendants)
-- =============================================================================

CREATE TABLE IF NOT EXISTS blueprint.lookup_lists (
    id            SERIAL PRIMARY KEY,
    org_id        INTEGER NOT NULL REFERENCES blueprint.organizations(id),
    name          TEXT NOT NULL,
    description   TEXT,
    sort_mode     TEXT NOT NULL DEFAULT 'alpha' CHECK (sort_mode IN ('alpha', 'manual')),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS blueprint.lookup_values (
    id            SERIAL PRIMARY KEY,
    list_id       INTEGER NOT NULL REFERENCES blueprint.lookup_lists(id) ON DELETE CASCADE,
    label         TEXT NOT NULL,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lookup_values_list ON blueprint.lookup_values(list_id);

-- =============================================================================
-- 2. Extend work_item_type_fields — richer field definitions
-- =============================================================================

-- lookup_list_id: for select/multi_select fields backed by a shared lookup list
ALTER TABLE blueprint.work_item_type_fields
  ADD COLUMN IF NOT EXISTS lookup_list_id INTEGER REFERENCES blueprint.lookup_lists(id);

-- constraints: type-specific validation rules as JSONB
-- e.g. { "min": 0, "max": 100 } for number, { "max_length": 500 } for text
ALTER TABLE blueprint.work_item_type_fields
  ADD COLUMN IF NOT EXISTS constraints JSONB;

-- default_value: pre-populated value for new work items
ALTER TABLE blueprint.work_item_type_fields
  ADD COLUMN IF NOT EXISTS default_value JSONB;

-- Note: field_options (existing) continues to serve as inline options for select/multi_select
-- when lookup_list_id is null. Format changes to: [{ "id": 1, "label": "Critical" }, ...]
-- Old format (["option1","option2"]) will be migrated on read if encountered.

-- =============================================================================
-- 3. Extend work_item_class_fields — same additions
-- =============================================================================

ALTER TABLE blueprint.work_item_class_fields
  ADD COLUMN IF NOT EXISTS lookup_list_id INTEGER REFERENCES blueprint.lookup_lists(id);

ALTER TABLE blueprint.work_item_class_fields
  ADD COLUMN IF NOT EXISTS constraints JSONB;

ALTER TABLE blueprint.work_item_class_fields
  ADD COLUMN IF NOT EXISTS default_value JSONB;

-- =============================================================================
-- 4. Acceptance criteria on work items
-- JSONB array: [{ "id": 1, "text": "Unit tests pass", "checked": false }, ...]
-- =============================================================================

ALTER TABLE runtime.work_items
  ADD COLUMN IF NOT EXISTS acceptance_criteria JSONB DEFAULT '[]';

-- =============================================================================
-- 5. Default acceptance criteria template on work item types
-- Copied to work items on creation
-- =============================================================================

ALTER TABLE blueprint.work_item_types
  ADD COLUMN IF NOT EXISTS default_acceptance_criteria JSONB DEFAULT '[]';

-- =============================================================================
-- 6. Normalize field_type values in existing tables
-- Old types: 'multiselect', 'currency' → new: 'multi_select', 'number'
-- =============================================================================

UPDATE blueprint.work_item_type_fields
  SET field_type = 'multi_select' WHERE field_type = 'multiselect';

UPDATE blueprint.work_item_type_fields
  SET field_type = 'number' WHERE field_type = 'currency';

UPDATE blueprint.work_item_class_fields
  SET field_type = 'multi_select' WHERE field_type = 'multiselect';

UPDATE blueprint.work_item_class_fields
  SET field_type = 'number' WHERE field_type = 'currency';

-- Update the CHECK constraint comment for field_type (informational):
-- Valid types: text, textarea, number, boolean, date, url, select, multi_select, user, org
