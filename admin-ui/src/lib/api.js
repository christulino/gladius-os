// Central API client for all admin endpoints

const BASE = '/admin/api'

async function apiFetch(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  // If 401, signal the app to show login
  if (res.status === 401) {
    const err = new Error('Authentication required')
    err.status = 401
    throw err
  }
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`)
  return data
}

async function authFetch(path, options = {}) {
  const res = await fetch('/auth' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`)
  return data
}

export const auth = {
  status:  () => authFetch('/status'),
  login:   (email, password) => authFetch('/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout:  () => authFetch('/logout', { method: 'POST' }),
  setup:   (data) => authFetch('/setup', { method: 'POST', body: JSON.stringify(data) }),
  me:      () => authFetch('/me'),
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

  // Type Fields
  typeFields:        (type_id) => apiFetch(`/type-fields?type_id=${type_id}`),
  createTypeField:   (data) => apiFetch('/type-fields', { method: 'POST', body: JSON.stringify(data) }),
  updateTypeField:   (id, data) => apiFetch(`/type-fields/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTypeField:   (id) => apiFetch(`/type-fields/${id}`, { method: 'DELETE' }),

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
  prepareTransition:   (id, to_stage_id) => apiFetch(`/work-items/${id}/transition/prepare?to_stage_id=${to_stage_id}`),
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

  // Org Members
  orgMembers:        (org_id) => apiFetch(`/org-members?org_id=${org_id}`),
  addOrgMember:      (data) => apiFetch('/org-members', { method: 'POST', body: JSON.stringify(data) }),
  updateOrgMember:   (id, data) => apiFetch(`/org-members/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  removeOrgMember:   (id) => apiFetch(`/org-members/${id}`, { method: 'DELETE' }),

  // Org Workflows
  orgWorkflows:      (org_id) => apiFetch(`/org-workflows?org_id=${org_id}`),

  // Org WIP Limits
  orgWipLimits:      (org_id) => apiFetch(`/org-wip-limits?org_id=${org_id}`),
  setOrgWipLimit:    (data) => apiFetch('/org-wip-limits', { method: 'PUT', body: JSON.stringify(data) }),
  deleteOrgWipLimit: (id) => apiFetch(`/org-wip-limits/${id}`, { method: 'DELETE' }),

  // Policy Data
  orgPolicyData:        (org_id) => apiFetch(`/org-policy-data?org_id=${org_id}`),

  // Transitions
  updateTransition:     (id, data) => apiFetch(`/transitions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Exit Criteria (blueprint CRUD)
  exitCriteria:         (stage_id) => apiFetch(`/exit-criteria?stage_id=${stage_id}`),
  createExitCriteria:   (data) => apiFetch('/exit-criteria', { method: 'POST', body: JSON.stringify(data) }),
  updateExitCriteria:   (id, data) => apiFetch(`/exit-criteria/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteExitCriteria:   (id) => apiFetch(`/exit-criteria/${id}`, { method: 'DELETE' }),

  // Exit Criteria (runtime status)
  workItemCriteriaStatus: (id) => apiFetch(`/work-items/${id}/exit-criteria-status`),
  acknowledgeCriterion:   (workItemId, criteriaId) => apiFetch(`/work-items/${workItemId}/exit-criteria/${criteriaId}/acknowledge`, { method: 'POST' }),
  unacknowledgeCriterion: (workItemId, criteriaId) => apiFetch(`/work-items/${workItemId}/exit-criteria/${criteriaId}/acknowledge`, { method: 'DELETE' }),
  waiveCriterion:         (workItemId, criteriaId, reason) => apiFetch(`/work-items/${workItemId}/exit-criteria/${criteriaId}/waive`, { method: 'POST', body: JSON.stringify({ reason }) }),

  // Transition Role Restrictions
  transitionRoles:      (transition_id) => apiFetch(`/transition-roles?transition_id=${transition_id}`),
  addTransitionRole:    (data) => apiFetch('/transition-roles', { method: 'POST', body: JSON.stringify(data) }),
  removeTransitionRole: (id) => apiFetch(`/transition-roles/${id}`, { method: 'DELETE' }),

  // Transition Actions
  transitionActions:      (transition_id) => apiFetch(`/transition-actions?transition_id=${transition_id}`),
  createTransitionAction: (data) => apiFetch('/transition-actions', { method: 'POST', body: JSON.stringify(data) }),
  updateTransitionAction: (id, data) => apiFetch(`/transition-actions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTransitionAction: (id) => apiFetch(`/transition-actions/${id}`, { method: 'DELETE' }),

  // Stage-Class WIP Limits
  setOrgWipClassLimit:    (data) => apiFetch('/org-wip-class-limits', { method: 'PUT', body: JSON.stringify(data) }),
  deleteOrgWipClassLimit: (id) => apiFetch(`/org-wip-class-limits/${id}`, { method: 'DELETE' }),

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
  cloneWorkflow:  (id, data) => apiFetch(`/workflows/${id}/clone`, { method: 'POST', body: JSON.stringify(data) }),
  reorderStages:  (workflowId, order) => apiFetch(`/workflows/${workflowId}/stages/reorder`, { method: 'PUT', body: JSON.stringify({ order }) }),

  // Other
  workflows:         () => apiFetch('/workflows'),
  transitionHistory: (limit = 50, offset = 0) => apiFetch(`/transition-history?limit=${limit}&offset=${offset}`),
  tables:            () => apiFetch('/tables'),
  tableData:         (schema, table, limit = 50, offset = 0) =>
                       apiFetch(`/tables/${schema}/${table}?limit=${limit}&offset=${offset}`),
  logs:              (limit = 200) => apiFetch(`/logs?limit=${limit}`),

  // Lookup Lists
  lookupLists:         (org_id) => apiFetch(`/lookup-lists${org_id ? `?org_id=${org_id}` : ''}`),
  createLookupList:    (data) => apiFetch('/lookup-lists', { method: 'POST', body: JSON.stringify(data) }),
  updateLookupList:    (id, data) => apiFetch(`/lookup-lists/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  lookupValues:        (listId) => apiFetch(`/lookup-lists/${listId}/values`),
  createLookupValue:   (listId, data) => apiFetch(`/lookup-lists/${listId}/values`, { method: 'POST', body: JSON.stringify(data) }),
  updateLookupValue:   (id, data) => apiFetch(`/lookup-values/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  reorderLookupValues: (listId, order) => apiFetch(`/lookup-lists/${listId}/values/reorder`, { method: 'PUT', body: JSON.stringify({ order }) }),

  // Acceptance Criteria
  acceptanceCriteria:     (wiId) => apiFetch(`/work-items/${wiId}/acceptance-criteria`),
  updateAcceptanceCriteria: (wiId, items) => apiFetch(`/work-items/${wiId}/acceptance-criteria`, { method: 'PUT', body: JSON.stringify({ items }) }),

  // Reports
  reportDeliveryTime:    (params) => apiFetch(`/reports/delivery-time?${new URLSearchParams(params)}`),
  reportThroughput:      (params) => apiFetch(`/reports/throughput?${new URLSearchParams(params)}`),
  reportCycleTimeByStage:(params) => apiFetch(`/reports/cycle-time-by-stage?${new URLSearchParams(params)}`),

  query: (sql) => apiFetch('/query', {
    method: 'POST',
    body:   JSON.stringify({ sql }),
  }),

  edit: (entityType, id, updates) => apiFetch(`/edit/${entityType}/${id}`, {
    method: 'PATCH',
    body:   JSON.stringify(updates),
  }),

  // Simulation
  simulationStart:    (data) => apiFetch('/simulation/start', { method: 'POST', body: JSON.stringify(data || {}) }),
  simulationStop:     () => apiFetch('/simulation/stop', { method: 'POST' }),
  simulationPause:    () => apiFetch('/simulation/pause', { method: 'POST' }),
  simulationResume:   () => apiFetch('/simulation/resume', { method: 'POST' }),
  simulationSpeed:    (speed) => apiFetch('/simulation/speed', { method: 'PUT', body: JSON.stringify({ speed }) }),
  simulationStatus:   () => apiFetch('/simulation/status'),

  // Service Catalog
  catalogItems:       (org_id) => apiFetch(`/catalog-items?org_id=${org_id}`),
  createCatalogItem:  (data) => apiFetch('/catalog-items', { method: 'POST', body: JSON.stringify(data) }),
  updateCatalogItem:  (id, data) => apiFetch(`/catalog-items/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteCatalogItem:  (id) => apiFetch(`/catalog-items/${id}`, { method: 'DELETE' }),
}

// ─── Public forms API (no auth) ─────────────────────────────────────────────

async function formsFetch(path, options = {}) {
  const res = await fetch('/forms' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`)
  return data
}

export const forms = {
  getForm:  (slug) => formsFetch(`/${slug}`),
  submit:   (slug, data) => formsFetch(`/${slug}`, { method: 'POST', body: JSON.stringify(data) }),
}
