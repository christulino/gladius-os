/**
 * runtime/notifications/summaries.js
 * Pure function: (event, workItem) => short human-readable summary string.
 */

const MAX = 160

function truncate(s, n = 80) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

const RENDERERS = {
  'work_item.created':        (e, w) => `${w.display_key} created: ${truncate(w.title)}`,
  'work_item.edited':         (e, w) => `${w.display_key} edited`,
  'work_item.transitioned':   (e, w) => `${w.display_key} moved from ${e.payload.from_stage_name} to ${e.payload.to_stage_name}`,
  'work_item.substate_changed': (e, w) => `${w.display_key} is now ${e.payload.substate}`,
  'work_item.assigned':       (e, w) => `${w.display_key} — ${e.payload.user_name ?? 'someone'} added as ${e.payload.relationship_type}`,
  'work_item.commented':      (e, w) => `${e.payload.author_name ?? 'Someone'} commented on ${w.display_key}: ${truncate(e.payload.body, 80)}`,
  'work_item.spawned':        (e, w) => `${w.display_key} was spawned`,
  'work_item.linked':         (e, w) => `${w.display_key} linked to ${e.payload.linked_display_key ?? 'another item'}`,
  'exit_criteria.acknowledged':   (e, w) => `Exit criterion checked on ${w.display_key}: ${truncate(e.payload.criterion_label, 60)}`,
  'exit_criteria.unacknowledged': (e, w) => `Exit criterion un-checked on ${w.display_key}: ${truncate(e.payload.criterion_label, 60)}`,
  'exit_criteria.waived':         (e, w) => `Exit criterion waived on ${w.display_key}: ${truncate(e.payload.criterion_label, 60)}`,
}

export function renderSummary(event, workItem) {
  const fn = RENDERERS[event.event_type]
  const out = fn ? fn(event, workItem) : `${workItem.display_key}: ${event.event_type}`
  return out.length > MAX ? out.slice(0, MAX - 1) + '…' : out
}

export default { renderSummary }
