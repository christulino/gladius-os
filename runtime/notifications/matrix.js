/**
 * runtime/notifications/matrix.js
 * Loads the default role×event-type matrix and a user's sparse overrides,
 * returning a pure in-memory object plus a helper. No side effects.
 */

import { query } from '../../db/postgres.js'

function key(rel, type) { return `${rel}|${type}` }

export async function loadMatrix(userId) {
  const [{ rows: defaults }, { rows: overrides }] = await Promise.all([
    query('SELECT relationship_type, event_type, enabled FROM blueprint.notification_defaults'),
    query('SELECT relationship_type, event_type, enabled FROM blueprint.user_notification_overrides WHERE user_id = $1', [userId]),
  ])
  const matrix = {
    defaults:  new Map(defaults.map(r => [key(r.relationship_type, r.event_type), r.enabled])),
    overrides: new Map(overrides.map(r => [key(r.relationship_type, r.event_type), r.enabled])),
  }
  return {
    ...matrix,
    isEnabled: (rel, type) => isEnabled(matrix, rel, type),
  }
}

export function isEnabled(matrix, rel, type) {
  const k = key(rel, type)
  if (matrix.overrides.has(k)) return matrix.overrides.get(k)
  return matrix.defaults.get(k) ?? false
}

export default { loadMatrix, isEnabled }
