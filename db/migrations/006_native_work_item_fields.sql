-- Migration 006: Native work item fields
-- Adds commonly-used fields as real columns for query performance.
-- Fields: priority, tags, estimate, started_at, resolved_at, origin, requester_id

ALTER TABLE runtime.work_items
  ADD COLUMN IF NOT EXISTS priority       INTEGER,            -- 1=Critical, 2=High, 3=Medium, 4=Low
  ADD COLUMN IF NOT EXISTS tags           TEXT[] DEFAULT '{}', -- freeform labels, GIN-indexed
  ADD COLUMN IF NOT EXISTS estimate       NUMERIC,            -- story points / hours / abstract units
  ADD COLUMN IF NOT EXISTS started_at     TIMESTAMPTZ,        -- set on first transition out of intake/queued
  ADD COLUMN IF NOT EXISTS resolved_at    TIMESTAMPTZ,        -- set when entering a terminal stage
  ADD COLUMN IF NOT EXISTS estimate_unit  TEXT DEFAULT 'points', -- 'points','hours','days','dollars'
  ADD COLUMN IF NOT EXISTS origin         TEXT DEFAULT 'manual', -- 'manual','web','email','slack','api','spawn'
  ADD COLUMN IF NOT EXISTS requester_id   INTEGER REFERENCES blueprint.users(id); -- who asked for this work

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_work_items_priority    ON runtime.work_items (priority) WHERE priority IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_tags        ON runtime.work_items USING GIN (tags) WHERE tags != '{}';
CREATE INDEX IF NOT EXISTS idx_work_items_requester   ON runtime.work_items (requester_id) WHERE requester_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_started_at  ON runtime.work_items (started_at) WHERE started_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_resolved_at ON runtime.work_items (resolved_at) WHERE resolved_at IS NOT NULL;
