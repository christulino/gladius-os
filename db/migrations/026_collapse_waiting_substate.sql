-- db/migrations/026_collapse_waiting_substate.sql
-- FEAT.25491 — Cut the service-class + substate vocabulary.
--
-- The runtime substate model is collapsed from three values
-- (active | blocked | waiting) to two (active | blocked). The transition
-- engine no longer produces 'waiting' (a stage's has_waiting_queue flag used to
-- land items in 'waiting'; entering a stage now always lands 'active'), and the
-- board no longer renders a waiting-queue split. A 'waiting' item was, in
-- practice, an item blocked on downstream capacity — so existing 'waiting' rows
-- are re-labelled to 'blocked' rather than dropped.
--
-- Scope notes:
--   * runtime.work_items.current_substate is a plain TEXT value column with NO
--     CHECK constraint (verified against the live schema: the only CHECK
--     constraints on the table are work_items_work_nature_check and
--     work_item_owner_check). There is therefore no constraint to tighten here,
--     and no new constraint is added — the application layer is the source of
--     the two-value vocabulary. This migration only re-labels data.
--   * current_substate is a value column, not a key: the only index touching it
--     (idx_wi_board) is a non-unique btree, so re-labelling cannot collide.
--   * No DB columns are dropped (service_class_id and has_waiting_queue are
--     retained but go unwritten / unused by the collapsed model).
--
-- Idempotent: after this runs, no 'waiting' rows remain, so re-running is a
-- no-op (the UPDATE matches zero rows).

UPDATE runtime.work_items
   SET current_substate = 'blocked'
 WHERE current_substate = 'waiting';
