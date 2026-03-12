/**
 * simulation/apiClient.js
 * Thin wrapper around the Flow OS REST API for simulation agents.
 * All calls go through the real API — no direct DB access.
 */

const BASE = 'http://localhost:3000/admin/api'

async function apiFetch(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`)
  return data
}

export const apiClient = {
  // Organizations
  organizations:      () => apiFetch('/organizations'),

  // Users
  users:              () => apiFetch('/users'),

  // Work Item Types
  witTypes:           () => apiFetch('/work-item-types'),

  // Workflows (includes stages + transitions)
  workflows:          () => apiFetch('/workflows'),

  // Board
  board:              (org_id) => apiFetch(`/board?org_id=${org_id}`),

  // Work Items
  workItems:          (limit = 200) => apiFetch(`/work-items?limit=${Math.min(limit, 200)}&offset=0`),
  workItem:           (id) => apiFetch(`/work-items/${id}`),
  createWorkItem:     (data) => apiFetch('/work-items', { method: 'POST', body: JSON.stringify(data) }),
  updateWorkItem:     (id, data) => apiFetch(`/work-items/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Transitions
  workItemTransitions: (id) => apiFetch(`/work-items/${id}/transitions`),
  transitionWorkItem:  (id, to_stage_id, reason) => apiFetch(`/work-items/${id}/transition`, {
    method: 'POST',
    body: JSON.stringify({ to_stage_id, reason }),
  }),

  // Comments
  addComment:         (id, body) => apiFetch(`/work-items/${id}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  }),

  // Relationships
  workItemRelationships: (id) => apiFetch(`/work-items/${id}/relationships`),
  addRelationship:    (id, user_id, relationship_type) => apiFetch(`/work-items/${id}/relationships`, {
    method: 'POST',
    body: JSON.stringify({ user_id, relationship_type }),
  }),

  // Sub-state
  setSubstate:        (id, substate) => apiFetch(`/work-items/${id}/substate`, {
    method: 'POST',
    body: JSON.stringify({ substate }),
  }),

  // Linking
  addWorkItemLink:    (id, target_work_item_id, link_type) => apiFetch(`/work-items/${id}/links`, {
    method: 'POST',
    body: JSON.stringify({ target_work_item_id, link_type }),
  }),
}
