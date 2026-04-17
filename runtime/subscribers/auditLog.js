/**
 * runtime/subscribers/auditLog.js
 * Consumes work_item.edited and writes one runtime.work_item_edits row per
 * field change, all sharing the event's edit_group_id. Idempotent via the
 * UNIQUE(edit_group_id, field_key) constraint on the audit table.
 */

import { query } from '../../db/postgres.js'

export function handlesEventType(eventType) {
  return eventType === 'work_item.edited'
}

export async function auditLogHandler(event) {
  const { edit_group_id, changes } = event.payload ?? {}
  if (!edit_group_id || !Array.isArray(changes)) {
    throw new Error('work_item.edited payload missing edit_group_id or changes[]')
  }

  for (const change of changes) {
    const { field, type, old: oldVal, new: newVal } = change
    if (!field || !type) {
      throw new Error(`change entry missing field/type: ${JSON.stringify(change)}`)
    }
    await query(`
      INSERT INTO runtime.work_item_edits
        (work_item_id, edited_by, edited_at, edit_group_id,
         field_key, field_type, old_value, new_value)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
      ON CONFLICT (edit_group_id, field_key) DO NOTHING
    `, [
      event.entity_id,
      event.actor_id,
      event.occurred_at,
      edit_group_id,
      field,
      type,
      oldVal === undefined ? null : JSON.stringify(oldVal),
      newVal === undefined ? null : JSON.stringify(newVal),
    ])
  }
}

export default { auditLogHandler, handlesEventType }
