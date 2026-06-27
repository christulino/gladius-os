/**
 * tests/helpers/cleanup.js
 *
 * DB-level hard-delete helper for test teardown.
 *
 * WHY: Integration tests that create work items via the HTTP API have no
 * REST delete endpoint (work items are intentionally never hard-deleted in
 * production). Without teardown, every test run leaves artifacts on the
 * dogfood board (org 109), polluting the live board and forcing the backlog
 * grinder's curate step to filter around junk items.
 *
 * HOW: Tests import `query` from db/postgres.js for direct DB access —
 * an established pattern in exit-criteria-waiver.test.js and
 * exit-criteria-context-entry.test.js. This helper wraps the same deletion
 * sequence used by scripts/deleteTestItems.js.
 *
 * USAGE:
 *   import { after } from 'node:test'
 *   import { deleteWorkItems } from './helpers/cleanup.js'
 *
 *   after(async () => {
 *     await deleteWorkItems([workItemId])
 *   })
 */

import { query } from '../../db/postgres.js'

/**
 * Hard-delete one or more work items by ID.
 *
 * Removes all non-cascaded dependent rows first, then deletes the work items
 * themselves. The work_items FK CASCADE handles: work_item_edits,
 * work_item_search, attachments, context_entries, notifications,
 * notification_deliveries, playbook_runs.
 *
 * Errors are swallowed per-statement so a partial cleanup can't mask a test
 * assertion failure. Pass `{ strict: true }` to let errors propagate.
 *
 * @param {number[]} ids       Work item IDs to delete
 * @param {{ strict?: boolean }} [opts]
 */
export async function deleteWorkItems(ids, { strict = false } = {}) {
  if (!ids || ids.length === 0) return

  const validIds = ids.filter(id => typeof id === 'number' && Number.isFinite(id))
  if (validIds.length === 0) return

  const handle = strict
    ? (fn) => fn()
    : (fn) => fn().catch(() => {})

  // Remove non-cascade-covered dependent rows
  const nonCascade = [
    // FK work_item_id — no CASCADE on delete
    'DELETE FROM runtime.work_item_user_relationships WHERE work_item_id = ANY($1::int[])',
    'DELETE FROM runtime.work_item_comments          WHERE work_item_id = ANY($1::int[])',
    'DELETE FROM runtime.stage_transition_history    WHERE work_item_id = ANY($1::int[])',
    'DELETE FROM runtime.substate_history            WHERE work_item_id = ANY($1::int[])',
    'DELETE FROM runtime.checklist_completions       WHERE work_item_id = ANY($1::int[])',
    'DELETE FROM runtime.evidence                    WHERE work_item_id = ANY($1::int[])',
    'DELETE FROM runtime.exit_criteria_status        WHERE work_item_id = ANY($1::int[])',
    'DELETE FROM runtime.flow_metrics_snapshots      WHERE work_item_id = ANY($1::int[])',
    // entity_id has no FK — filter by work_item.* event types
    `DELETE FROM runtime.events WHERE entity_id = ANY($1::int[]) AND event_type LIKE 'work_item.%'`,
    // work_item_links uses source/target columns, not work_item_id
    'DELETE FROM runtime.work_item_links WHERE source_work_item_id = ANY($1::int[]) OR target_work_item_id = ANY($1::int[])',
  ]

  for (const sql of nonCascade) {
    await handle(() => query(sql, [validIds]))
  }

  // transition_action_log has two nullable FKs — clear spawned_work_item_id refs first
  await handle(() => query(
    'UPDATE runtime.transition_action_log SET spawned_work_item_id = NULL WHERE spawned_work_item_id = ANY($1::int[])',
    [validIds],
  ))
  await handle(() => query(
    'DELETE FROM runtime.transition_action_log WHERE work_item_id = ANY($1::int[])',
    [validIds],
  ))

  // Main delete — CASCADE covers the rest
  await handle(() => query(
    'DELETE FROM runtime.work_items WHERE id = ANY($1::int[])',
    [validIds],
  ))
}
