/**
 * core/events.js
 * Event emission and post-commit nudge.
 *
 * emitEvent MUST be called inside an open PostgreSQL transaction (pass the
 * client that owns BEGIN, not the pool). The event row commits with the
 * caller's transaction — no phantom events if the caller rolls back.
 *
 * nudgeAfterCommit is fire-and-forget; call it after your COMMIT succeeds.
 * It asks the processor to drain right away; if there is no in-process
 * primary, the safety-net poll picks up the event within ~30 seconds.
 */

import { nudge } from '../runtime/eventProcessor.js'

/**
 * Insert an event row. Must run inside the caller's open transaction.
 *
 * @param {pg.PoolClient} client   - PG client that owns the transaction
 * @param {Object}        options
 * @param {string}        options.eventType   - Dotted type, e.g. 'work_item.transitioned'
 * @param {number}        options.entityId    - PK of the entity that changed
 * @param {string}        [options.entityUri] - flowos:// URI, optional
 * @param {number|null}   [options.actorId]   - user id, null for system-initiated
 * @param {Object}        [options.payload]   - JSON-serializable payload
 * @returns {Promise<number>} the new event id
 */
export async function emitEvent(client, { eventType, entityId, entityUri, actorId, payload }) {
  if (!client || typeof client.query !== 'function') {
    throw new Error('emitEvent requires a pg client (inside a transaction)')
  }
  if (!eventType || typeof eventType !== 'string') {
    throw new Error('emitEvent requires eventType (string)')
  }
  if (entityId == null) {
    throw new Error('emitEvent requires entityId')
  }

  const result = await client.query(`
    INSERT INTO runtime.events (event_type, entity_id, entity_uri, actor_id, payload)
    VALUES ($1, $2, $3, $4, $5::jsonb)
    RETURNING id
  `, [
    eventType,
    entityId,
    entityUri ?? null,
    actorId ?? null,
    JSON.stringify(payload ?? {}),
  ])

  return Number(result.rows[0].id)
}

/**
 * Ask the event processor to drain now. Fire-and-forget.
 * Call this AFTER your COMMIT succeeds — not inside the transaction.
 */
export function nudgeAfterCommit() {
  setImmediate(() => nudge())
}

export default { emitEvent, nudgeAfterCommit }
