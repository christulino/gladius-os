-- Migration 008: Done retention policy
-- Completed items stay visible on the board for a configurable number of days.

ALTER TABLE blueprint.organizations
  ADD COLUMN IF NOT EXISTS done_retention_days INTEGER NOT NULL DEFAULT 14;

COMMENT ON COLUMN blueprint.organizations.done_retention_days IS
  'Number of days completed work items remain visible on the board. 0 = hide immediately.';
