// Central API client for all admin endpoints

const BASE = '/admin/api'

async function apiFetch(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`)
  return data
}

export const api = {
  summary:           () => apiFetch('/summary'),

  // Organizations
  organizations:      () => apiFetch('/organizations'),
  createOrganization: (data) => apiFetch('/organizations', { method: 'POST', body: JSON.stringify(data) }),
  updateOrganization: (id, data) => apiFetch(`/organizations/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Org Types
  orgTypes:          () => apiFetch('/org-types'),
  createOrgType:     (data) => apiFetch('/org-types', { method: 'POST', body: JSON.stringify(data) }),
  updateOrgType:     (id, data) => apiFetch(`/org-types/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Roles
  roles:             () => apiFetch('/roles'),
  createRole:        (data) => apiFetch('/roles', { method: 'POST', body: JSON.stringify(data) }),
  updateRole:        (id, data) => apiFetch(`/roles/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Permissions
  permissions:       () => apiFetch('/permissions'),
  rolePermissions:   (role_id, org_id) => apiFetch(`/role-permissions?role_id=${role_id}${org_id ? `&org_id=${org_id}` : ''}`),
  saveRolePermissions: (data) => apiFetch('/role-permissions', { method: 'PUT', body: JSON.stringify(data) }),

  // Users
  users:             () => apiFetch('/users'),
  createUser:        (data) => apiFetch('/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser:        (id, data) => apiFetch(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Work Item Type Classes
  witClasses:        () => apiFetch('/work-item-type-classes'),
  createWitClass:    (data) => apiFetch('/work-item-type-classes', { method: 'POST', body: JSON.stringify(data) }),
  updateWitClass:    (id, data) => apiFetch(`/work-item-type-classes/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Class Fields
  classFields:       (class_id) => apiFetch(`/class-fields?class_id=${class_id}`),
  createClassField:  (data) => apiFetch('/class-fields', { method: 'POST', body: JSON.stringify(data) }),
  updateClassField:  (id, data) => apiFetch(`/class-fields/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteClassField:  (id) => apiFetch(`/class-fields/${id}`, { method: 'DELETE' }),

  // Work Item Types
  witTypes:          () => apiFetch('/work-item-types'),
  createWitType:     (data) => apiFetch('/work-item-types', { method: 'POST', body: JSON.stringify(data) }),
  updateWitType:     (id, data) => apiFetch(`/work-item-types/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Work Items
  workItems:         (limit = 50, offset = 0) => apiFetch(`/work-items?limit=${limit}&offset=${offset}`),
  workItem:          (id) => apiFetch(`/work-items/${id}`),
  updateWorkItem:    (id, data) => apiFetch(`/work-items/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  setSubstate:       (id, substate) => apiFetch(`/work-items/${id}/substate`, { method: 'POST', body: JSON.stringify({ substate }) }),
  workItemTransitions: (id) => apiFetch(`/work-items/${id}/transitions`),
  transitionWorkItem:  (id, to_stage_id, reason) => apiFetch(`/work-items/${id}/transition`, { method: 'POST', body: JSON.stringify({ to_stage_id, reason }) }),

  // Comments
  workItemComments:  (id) => apiFetch(`/work-items/${id}/comments`),
  addComment:        (id, body, parent_comment_id) => apiFetch(`/work-items/${id}/comments`, { method: 'POST', body: JSON.stringify({ body, parent_comment_id }) }),

  // User Relationships
  workItemRelationships: (id) => apiFetch(`/work-items/${id}/relationships`),
  addRelationship:   (id, user_id, relationship_type) => apiFetch(`/work-items/${id}/relationships`, { method: 'POST', body: JSON.stringify({ user_id, relationship_type }) }),
  removeRelationship: (id) => apiFetch(`/work-item-relationships/${id}`, { method: 'DELETE' }),

  // Work Item Search + Linking
  searchWorkItems:   (q) => apiFetch(`/work-items/search?q=${encodeURIComponent(q)}`),
  addWorkItemLink:   (id, target_work_item_id, link_type) => apiFetch(`/work-items/${id}/links`, { method: 'POST', body: JSON.stringify({ target_work_item_id, link_type }) }),
  workItemLinks:     (id) => apiFetch(`/work-items/${id}/links`),

  // Org WIP Limits
  orgWipLimits:      (org_id) => apiFetch(`/org-wip-limits?org_id=${org_id}`),
  setOrgWipLimit:    (data) => apiFetch('/org-wip-limits', { method: 'PUT', body: JSON.stringify(data) }),
  deleteOrgWipLimit: (id) => apiFetch(`/org-wip-limits/${id}`, { method: 'DELETE' }),

  // Uploads
  uploadAvatar:   (data, filename) => apiFetch('/upload/avatar', {
    method: 'POST',
    body: JSON.stringify({ data, filename }),
  }),

  // Board
  board:          (org_id) => apiFetch(`/board?org_id=${org_id}`),
  serviceLibrary: (org_id) => apiFetch(`/service-library?org_id=${org_id}`),
  serviceClasses: (org_id) => apiFetch(`/service-classes${org_id ? `?org_id=${org_id}` : ''}`),
  createWorkItem: (data)   => apiFetch('/work-items', { method: 'POST', body: JSON.stringify(data) }),

  // Workflow Manager
  workflow:       (id) => apiFetch(`/workflows/${id}`),
  createWorkflow: (data) => apiFetch('/workflows', { method: 'POST', body: JSON.stringify(data) }),
  updateWorkflow: (id, data) => apiFetch(`/workflows/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  createStage:    (data) => apiFetch('/stages', { method: 'POST', body: JSON.stringify(data) }),
  updateStage:    (id, data) => apiFetch(`/stages/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteStage:    (id) => apiFetch(`/stages/${id}`, { method: 'DELETE' }),

  // Other
  workflows:         () => apiFetch('/workflows'),
  transitionHistory: (limit = 50, offset = 0) => apiFetch(`/transition-history?limit=${limit}&offset=${offset}`),
  tables:            () => apiFetch('/tables'),
  tableData:         (schema, table, limit = 50, offset = 0) =>
                       apiFetch(`/tables/${schema}/${table}?limit=${limit}&offset=${offset}`),
  logs:              (limit = 200) => apiFetch(`/logs?limit=${limit}`),

  query: (sql) => apiFetch('/query', {
    method: 'POST',
    body:   JSON.stringify({ sql }),
  }),

  edit: (entityType, id, updates) => apiFetch(`/edit/${entityType}/${id}`, {
    method: 'PATCH',
    body:   JSON.stringify(updates),
  }),
}
