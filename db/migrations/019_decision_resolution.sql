-- 019_decision_resolution.sql
-- FEAT.25360 — open/resolved lifecycle state for decision-type context entries.
--
-- Current state lives on the row (O(1) reads, gate-able by a future "decisions
-- resolved" exit criterion); the full resolve -> reopen -> re-resolve HISTORY lives
-- in the append-only event log (context_entry.decision_resolved /
-- context_entry.decision_reopened), consistent with the "tables = current state,
-- events = history" architecture. Reopen clears these columns; every prior answer
-- survives in its decision_resolved event payload.
--
-- Idempotent. Columns are additive and nullable except `resolved` (defaults false =
-- open), so existing rows are unaffected and existing SELECT ce.* reads keep working.

ALTER TABLE runtime.context_entries
  ADD COLUMN IF NOT EXISTS resolved        BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resolved_by     INTEGER     REFERENCES blueprint.users(id),
  ADD COLUMN IF NOT EXISTS resolved_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution_text TEXT;

-- Supports the "open decisions" journal filter and a cheap "all decisions resolved"
-- gate: find unresolved decision entries for a work item without scanning the table.
CREATE INDEX IF NOT EXISTS idx_context_entries_open_decisions
  ON runtime.context_entries (work_item_id)
  WHERE type = 'decision' AND resolved = false;
