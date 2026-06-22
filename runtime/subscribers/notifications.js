/**
 * runtime/subscribers/notifications.js
 * Resolves recipients via relationships + matrix, suppresses the actor,
 * dedups, and writes notifications + deliveries atomically.
 */

import { query, getClient } from '../../db/postgres.js'
import { loadMatrix } from '../notifications/matrix.js'
import { renderSummary } from '../notifications/summaries.js'
import { extractMentions } from '../notifications/mentions.js'

const HANDLED = new Set([
  'work_item.created',
  'work_item.edited',
  'work_item.transitioned',
  'work_item.substate_changed',
  'work_item.assigned',
  'work_item.commented',
  'work_item.comment_edited',
  'work_item.comment_deleted',
  'work_item.spawned',
  'work_item.linked',
  'exit_criteria.acknowledged',
  'exit_criteria.unacknowledged',
  'exit_criteria.waived',
])

export function handlesEventType(eventType) {
  return HANDLED.has(eventType)
}

async function fetchWorkItem(workItemId) {
  const { rows } = await query(
    `SELECT id, display_key, title, requester_id FROM runtime.work_items WHERE id = $1`,
    [workItemId]
  )
  return rows[0] ?? null
}

async function fetchRelationships(workItemId) {
  const { rows } = await query(
    `SELECT user_id, relationship_type
       FROM runtime.work_item_user_relationships
      WHERE work_item_id = $1 AND is_active = true`,
    [workItemId]
  )
  return rows
}

async function fetchHandleMap() {
  const { rows } = await query(
    `SELECT id, split_part(email, '@', 1) AS handle FROM blueprint.users WHERE is_active = true`
  )
  const m = {}
  for (const r of rows) m[r.handle] = r.id
  return m
}

async function fetchEnabledOutOfBandChannels(userId) {
  const { rows } = await query(
    `SELECT channel FROM blueprint.user_notification_channels
      WHERE user_id = $1 AND is_enabled = true AND channel = 'agent'`,
    [userId]
  )
  return rows.map(r => r.channel)
}

export async function notificationsHandler(event) {
  if (!HANDLED.has(event.event_type)) return

  const workItem = await fetchWorkItem(event.entity_id)
  if (!workItem) return

  // Build candidate map: userId -> Set of relationship reasons
  const candidates = new Map()
  const addCandidate = (uid, rel) => {
    if (uid == null) return
    if (!candidates.has(uid)) candidates.set(uid, new Set())
    candidates.get(uid).add(rel)
  }

  for (const r of await fetchRelationships(workItem.id)) {
    addCandidate(r.user_id, r.relationship_type)
  }
  addCandidate(workItem.requester_id, 'requester')

  if (event.event_type === 'work_item.commented') {
    const handleMap = await fetchHandleMap()
    for (const uid of extractMentions(event.payload?.body, handleMap)) {
      addCandidate(uid, 'mentioned')
    }
  }

  // Suppress the actor — they triggered the event, no self-notification
  if (event.actor_id) candidates.delete(event.actor_id)

  // Filter by matrix: only keep users for whom at least one relationship is enabled
  const recipients = new Map()
  for (const [userId, rels] of candidates) {
    const matrix = await loadMatrix(userId)
    const kept = []
    for (const rel of rels) if (matrix.isEnabled(rel, event.event_type)) kept.push(rel)
    if (kept.length) recipients.set(userId, kept)
  }
  if (recipients.size === 0) return

  const client = await getClient()
  try {
    await client.query('BEGIN')
    for (const [userId, reasons] of recipients) {
      const summary = renderSummary(event, workItem)
      const ins = await client.query(
        `INSERT INTO runtime.notifications
           (user_id, event_id, work_item_id, event_type, reasons, summary)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, event_id) DO NOTHING
         RETURNING id`,
        [userId, event.id, workItem.id, event.event_type, reasons, summary]
      )
      if (ins.rows.length === 0) continue  // idempotent: already written (replay)
      const notificationId = ins.rows[0].id

      const channels = await fetchEnabledOutOfBandChannels(userId)
      for (const ch of channels) {
        await client.query(
          `INSERT INTO runtime.notification_deliveries (notification_id, channel, status)
           VALUES ($1, $2, 'pending')`,
          [notificationId, ch]
        )
      }
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export default { notificationsHandler, handlesEventType }
