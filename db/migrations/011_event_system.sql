-- Migration 011: Event system
-- Adds runtime.events (append-only bus), runtime.event_subscribers (per-subscriber cursor),
-- and runtime.work_item_edits (Jira-shaped field audit).
-- Drops runtime.search_index_queue (retired).

-- pgcrypto required for gen_random_uuid() in work_item_edits
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- EVENT BUS (append-only log)
-- =============================================================================

CREATE TABLE IF NOT EXISTS runtime.events (
    id           BIGSERIAL    PRIMARY KEY,
    event_type   TEXT         NOT NULL,
    entity_id    INTEGER      NOT NULL,
    entity_uri   TEXT,
    actor_id     INTEGER      REFERENCES blueprint.users(id) ON DELETE SET NULL,
    occurred_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    payload      JSONB        NOT NULL
);

-- Primary reader query: "events for entity X, newest first"
-- Drain query (WHERE id > cursor ORDER BY id) is served by the PK index.
CREATE INDEX IF NOT EXISTS idx_events_type_entity
    ON runtime.events (entity_id, occurred_at DESC, event_type);

-- =============================================================================
-- SUBSCRIBER CURSORS (per-subscriber progress + health)
-- =============================================================================

CREATE TABLE IF NOT EXISTS runtime.event_subscribers (
    name                     TEXT         PRIMARY KEY,
    last_processed_event_id  BIGINT       NOT NULL DEFAULT 0,
    is_paused                BOOLEAN      NOT NULL DEFAULT FALSE,
    last_error               TEXT,
    last_error_at            TIMESTAMPTZ,
    failure_count            INTEGER      NOT NULL DEFAULT 0,
    last_success_at          TIMESTAMPTZ,
    events_processed_total   BIGINT       NOT NULL DEFAULT 0,
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- WORK ITEM FIELD-LEVEL EDIT AUDIT (Jira changegroup/changeitem analog)
-- =============================================================================

CREATE TABLE IF NOT EXISTS runtime.work_item_edits (
    id            BIGSERIAL    PRIMARY KEY,
    work_item_id  INTEGER      NOT NULL REFERENCES runtime.work_items(id) ON DELETE CASCADE,
    edited_by     INTEGER      REFERENCES blueprint.users(id) ON DELETE SET NULL,
    edited_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    edit_group_id UUID         NOT NULL DEFAULT gen_random_uuid(),
    field_key     TEXT         NOT NULL,
    field_type    TEXT         NOT NULL,
    old_value     JSONB,
    new_value     JSONB,
    UNIQUE (edit_group_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_work_item_edits_item
    ON runtime.work_item_edits (work_item_id, edited_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_item_edits_group
    ON runtime.work_item_edits (edit_group_id);

-- =============================================================================
-- RETIRE LEGACY
-- =============================================================================

DROP TABLE IF EXISTS runtime.search_index_queue;
