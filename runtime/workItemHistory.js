/**
 * runtime/workItemHistory.js
 * Audit trail for a single work item — unified view over runtime.events
 * (transitions, assignments, comments, links, exit criteria) plus the
 * field-level edit detail carried in work_item.edited payloads.
 */

import { query } from '../db/postgres.js'

const HISTORY_EVENT_TYPES = [
  'work_item.created',
  'work_item.edited',
  'work_item.transitioned',
  'work_item.substate_changed',
  'work_item.assigned',
  'work_item.unassigned',
  'work_item.commented',
  'work_item.comment_edited',
  'work_item.comment_deleted',
  'work_item.linked',
  'work_item.unlinked',
  'work_item.attachment_added',
  'work_item.attachment_removed',
  'exit_criteria.acknowledged',
  'exit_criteria.unacknowledged',
  'exit_criteria.waived',
  'transition_action.spawn_fired',
  'transition_action.api_call_fired',
]

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export async function getWorkItemHistory(workItemId, { limit = DEFAULT_LIMIT, before = null } = {}) {
  const cappedLimit = Math.min(Math.max(parseInt(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT)

  const params = [workItemId, HISTORY_EVENT_TYPES, cappedLimit]
  let cursorClause = ''
  if (before) {
    params.push(parseInt(before))
    cursorClause = `AND e.id < $${params.length}`
  }

  const { rows: events } = await query(`
    SELECT e.id, e.event_type, e.occurred_at, e.payload, e.actor_id,
           u.display_name AS actor_name, u.avatar_url AS actor_avatar
    FROM runtime.events e
    LEFT JOIN blueprint.users u ON u.id = e.actor_id
    WHERE e.entity_id = $1
      AND e.event_type = ANY($2::text[])
      ${cursorClause}
    ORDER BY e.id DESC
    LIMIT $3
  `, params)

  if (!events.length) return { rows: [], next_before: null }

  const enrichment = await loadEnrichment(events)
  const rows = events.map(e => formatEvent(e, enrichment))

  const nextBefore = events.length === cappedLimit ? events[events.length - 1].id : null
  return { rows, next_before: nextBefore }
}

async function loadEnrichment(events) {
  const fromStageIds = new Set()
  const userIds = new Set()
  const targetItemIds = new Set()

  for (const e of events) {
    const p = e.payload || {}
    if (e.event_type === 'work_item.transitioned' && p.from_stage_id) fromStageIds.add(p.from_stage_id)
    if ((e.event_type === 'work_item.assigned' || e.event_type === 'work_item.unassigned') && p.user_id) {
      userIds.add(p.user_id)
    }
    if (e.event_type === 'work_item.linked' && p.target_id) targetItemIds.add(p.target_id)
    if (e.event_type === 'work_item.unlinked' && p.target_id) targetItemIds.add(p.target_id)
  }

  const [stages, users, targets] = await Promise.all([
    fromStageIds.size
      ? query('SELECT id, name FROM blueprint.stages WHERE id = ANY($1::int[])', [[...fromStageIds]])
      : Promise.resolve({ rows: [] }),
    userIds.size
      ? query('SELECT id, display_name FROM blueprint.users WHERE id = ANY($1::int[])', [[...userIds]])
      : Promise.resolve({ rows: [] }),
    targetItemIds.size
      ? query('SELECT id, display_key, title FROM runtime.work_items WHERE id = ANY($1::int[])', [[...targetItemIds]])
      : Promise.resolve({ rows: [] }),
  ])

  return {
    stages: new Map(stages.rows.map(r => [r.id, r.name])),
    users: new Map(users.rows.map(r => [r.id, r.display_name])),
    targets: new Map(targets.rows.map(r => [r.id, r])),
  }
}

function formatEvent(e, enrich) {
  const p = e.payload || {}
  const actor = e.actor_id
    ? { id: e.actor_id, display_name: e.actor_name, avatar_url: e.actor_avatar }
    : null

  const base = {
    id: e.id,
    occurred_at: e.occurred_at,
    actor,
    event_type: e.event_type,
  }

  switch (e.event_type) {
    case 'work_item.created':
      return { ...base, summary: 'created this item', details: null }

    case 'work_item.edited': {
      const changes = Array.isArray(p.changes) ? p.changes : []
      const fieldList = changes.map(c => humanFieldName(c.field)).filter(Boolean)
      const summary = fieldList.length === 1
        ? `edited ${fieldList[0]}`
        : `edited ${fieldList.length} fields`
      return { ...base, summary, details: { changes } }
    }

    case 'work_item.transitioned': {
      const fromName = enrich.stages.get(p.from_stage_id) || 'previous stage'
      const toName = p.to_stage_name || 'next stage'
      const summary = `moved from ${fromName} to ${toName}`
      const details = p.reason ? { reason: p.reason } : null
      return { ...base, summary, details }
    }

    case 'work_item.substate_changed':
      return { ...base, summary: `marked ${p.new_substate}`, details: null }

    case 'work_item.assigned': {
      const name = enrich.users.get(p.user_id) || 'someone'
      return { ...base, summary: `added ${name} as ${p.relationship_type}`, details: null }
    }

    case 'work_item.unassigned': {
      const name = enrich.users.get(p.user_id) || 'someone'
      return { ...base, summary: `removed ${name} from ${p.relationship_type}`, details: null }
    }

    case 'work_item.commented': {
      const body = typeof p.body === 'string' ? p.body : ''
      const preview = body.length > 120 ? body.slice(0, 119) + '…' : body
      return { ...base, summary: `commented`, details: { preview } }
    }

    case 'work_item.comment_edited': {
      const preview = typeof p.new_body === 'string' && p.new_body.length > 120
        ? p.new_body.slice(0, 119) + '…' : (p.new_body || '')
      return { ...base, summary: `edited a comment`, details: { preview } }
    }

    case 'work_item.comment_deleted': {
      const preview = typeof p.body === 'string' && p.body.length > 120
        ? p.body.slice(0, 119) + '…' : (p.body || '')
      return { ...base, summary: `deleted a comment`, details: { preview } }
    }

    case 'work_item.linked': {
      const tgt = enrich.targets.get(p.target_id)
      const label = tgt ? `${tgt.display_key} ${tgt.title}` : 'another item'
      return { ...base, summary: `linked as ${p.link_type || 'related'} to ${label}`, details: null }
    }

    case 'work_item.unlinked': {
      const tgt = enrich.targets.get(p.target_id)
      const label = tgt ? tgt.display_key : 'another item'
      return { ...base, summary: `unlinked ${label}`, details: null }
    }

    case 'work_item.attachment_added': {
      const what = p.kind === 'file'
        ? (p.file_name || 'a file')
        : (p.url_title || p.url || 'a link')
      return { ...base, summary: `attached ${what}`, details: null }
    }

    case 'work_item.attachment_removed': {
      const what = p.kind === 'file'
        ? (p.file_name || 'a file')
        : (p.url_title || p.url || 'a link')
      return { ...base, summary: `removed attachment ${what}`, details: null }
    }

    case 'exit_criteria.acknowledged':
      return { ...base, summary: `checked exit criterion: ${p.criterion_label || ''}`, details: null }

    case 'exit_criteria.unacknowledged':
      return { ...base, summary: `un-checked exit criterion: ${p.criterion_label || ''}`, details: null }

    case 'exit_criteria.waived':
      return { ...base, summary: `waived exit criterion: ${p.criterion_label || ''}`, details: null }

    case 'transition_action.spawn_fired':
      return { ...base, summary: `spawned a child item`, details: null }

    case 'transition_action.api_call_fired':
      return { ...base, summary: `fired API call: ${p.method || 'POST'} ${p.endpoint || ''}`, details: null }

    default:
      return { ...base, summary: e.event_type, details: null }
  }
}

const FIELD_LABELS = {
  title: 'title',
  description: 'description',
  priority: 'priority',
  tags: 'tags',
  estimate: 'estimate',
  estimate_unit: 'estimate unit',
  due_date: 'due date',
  is_expedited: 'expedited flag',
  work_nature: 'work nature',
  origin: 'origin',
  requester_id: 'requester',
}

function humanFieldName(key) {
  if (!key) return ''
  if (FIELD_LABELS[key]) return FIELD_LABELS[key]
  return key.replace(/_/g, ' ')
}

export default { getWorkItemHistory }
