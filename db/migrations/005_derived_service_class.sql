-- Migration 005: Derived class of service from natural fields
-- Applied: Session 7
--
-- Instead of asking users to pick a service class, we derive it:
--   is_expedited = true              → Expedite
--   due_date IS NOT NULL             → Fixed Date
--   work_nature = 'improvement'      → Deferred
--   otherwise                        → Standard

-- =============================================================================
-- 1. Add natural fields to work items
-- =============================================================================

ALTER TABLE runtime.work_items
  ADD COLUMN IF NOT EXISTS due_date     TIMESTAMPTZ;

ALTER TABLE runtime.work_items
  ADD COLUMN IF NOT EXISTS is_expedited BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE runtime.work_items
  ADD COLUMN IF NOT EXISTS work_nature  TEXT NOT NULL DEFAULT 'delivery'
    CHECK (work_nature IN ('delivery', 'improvement'));

-- Index for board queries that filter by due_date
CREATE INDEX IF NOT EXISTS idx_wi_due_date ON runtime.work_items(due_date)
  WHERE due_date IS NOT NULL;
