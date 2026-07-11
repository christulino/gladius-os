-- db/migrations/024_rename_non_jql_outcome.sql
-- JQL was removed (migration 018), but runtime.translator_usage still used the
-- outcome label 'non_jql' for "model output was not a valid filter object".
-- Rename it to 'invalid_output' so no live code writes a JQL-era label, and
-- update the CHECK constraint to match.
-- Idempotent: the UPDATE is a no-op on re-run; the constraint is dropped
-- (IF EXISTS) and re-added with the same definition.

ALTER TABLE runtime.translator_usage
  DROP CONSTRAINT IF EXISTS translator_usage_outcome_check;

UPDATE runtime.translator_usage
  SET outcome = 'invalid_output'
  WHERE outcome = 'non_jql';

ALTER TABLE runtime.translator_usage
  ADD CONSTRAINT translator_usage_outcome_check
  CHECK (outcome IN ('success','parse_fail','invalid_output','timeout','upstream_error','rate_limited','budget_exhausted'));
