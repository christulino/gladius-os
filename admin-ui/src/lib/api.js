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
  if (!res.ok) {
    const err = new Error(data.error || `${res.status} ${res.statusText}`)
    err.status = res.status
    err.body = data
    throw err
  }
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
  bulkTransition:      (work_item_ids, to_stage_id, reason) => apiFetch('/work-items/bulk/transition', { method: 'POST', body: JSON.stringify({ work_item_ids, to_stage_id, reason }) }),
  bulkAssign:          (work_item_ids, user_id, relationship_type) => apiFetch('/work-items/bulk/assign', { method: 'POST', body: JSON.stringify({ work_item_ids, user_id, relationship_type }) }),

  // Comments
  workItemComments:  (id) => apiFetch(`/work-items/${id}/comments`),
  addComment:        (id, body, parent_comment_id) => apiFetch(`/work-items/${id}/comments`, { method: 'POST', body: JSON.stringify({ body, parent_comment_id }) }),
  editComment:       (workItemId, commentId, body) => apiFetch(`/work-items/${workItemId}/comments/${commentId}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  deleteComment:     (workItemId, commentId) => apiFetch(`/work-items/${workItemId}/comments/${commentId}`, { method: 'DELETE' }),

  // History (audit trail)
  workItemHistory:   (id, { limit = 50, before = null } = {}) => {
    const qs = new URLSearchParams({ limit: String(limit) })
    if (before) qs.set('before', String(before))
    return apiFetch(`/work-items/${id}/history?${qs.toString()}`)
  },

  // User Relationships
  workItemRelationships: (id) => apiFetch(`/work-items/${id}/relationships`),
  addRelationship:   (id, user_id, relationship_type) => apiFetch(`/work-items/${id}/relationships`, { method: 'POST', body: JSON.stringify({ user_id, relationship_type }) }),
  removeRelationship: (id) => apiFetch(`/work-item-relationships/${id}`, { method: 'DELETE' }),

  // Work Item Search + Linking
  searchWorkItems:   async (q) => {
    const res = await searchApi.query({ keyword: q }, { limit: 20 })
    return { rows: res.rows || [], count: (res.rows || []).length }
  },
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

  // Event subscribers & events
  eventSubscribers:       ()           => apiFetch('/event-subscribers'),
  pauseEventSubscriber:   (name, isPaused) =>
    apiFetch(`/event-subscribers/${encodeURIComponent(name)}/pause`, {
      method: 'POST',
      body:   JSON.stringify({ is_paused: isPaused }),
    }),
  skipPastEvent:          (name, eventId) =>
    apiFetch(`/event-subscribers/${encodeURIComponent(name)}/skip-past/${eventId}`, {
      method: 'POST',
    }),
  recentEvents:           ({ limit = 100, typePrefix } = {}) => {
    const q = new URLSearchParams({ limit: String(limit) })
    if (typePrefix) q.set('type_prefix', typePrefix)
    return apiFetch(`/events?${q}`)
  },

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

  // Context Entries
  contextEntries:     (workItemId, types) => apiFetch(`/work-items/${workItemId}/context-entries${types ? '?types='+types : ''}`),
  createContextEntry: (workItemId, data)  => apiFetch(`/work-items/${workItemId}/context-entries`, { method: 'POST', body: JSON.stringify(data) }),
  updateContextEntry: (workItemId, id, data) => apiFetch(`/work-items/${workItemId}/context-entries/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteContextEntry: (workItemId, id)    => apiFetch(`/work-items/${workItemId}/context-entries/${id}`, { method: 'DELETE' }),
  resolveDecisionEntry: (workItemId, id, data) => apiFetch(`/work-items/${workItemId}/context-entries/${id}/resolve`, { method: 'POST', body: JSON.stringify(data) }),
  reopenDecisionEntry:  (workItemId, id)       => apiFetch(`/work-items/${workItemId}/context-entries/${id}/reopen`, { method: 'POST' }),

  // Org Context Library
  orgContext:       (orgId, types) => apiFetch(`/organizations/${orgId}/context${types ? '?types='+types : ''}`),
  createOrgContext: (orgId, data)  => apiFetch(`/organizations/${orgId}/context`, { method: 'POST', body: JSON.stringify(data) }),
  updateOrgContext: (orgId, id, data) => apiFetch(`/organizations/${orgId}/context/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteOrgContext: (orgId, id)    => apiFetch(`/organizations/${orgId}/context/${id}`, { method: 'DELETE' }),

  // Org AI Models
  orgAiModels:      (orgId)        => apiFetch(`/organizations/${orgId}/ai-models`),
  createOrgAiModel: (orgId, data)  => apiFetch(`/organizations/${orgId}/ai-models`, { method: 'POST', body: JSON.stringify(data) }),
  updateOrgAiModel: (orgId, id, d) => apiFetch(`/organizations/${orgId}/ai-models/${id}`, { method: 'PATCH', body: JSON.stringify(d) }),
  deleteOrgAiModel: (orgId, id)    => apiFetch(`/organizations/${orgId}/ai-models/${id}`, { method: 'DELETE' }),

  // Stage Playbooks
  stagePlaybook:        (stageId)         => apiFetch(`/stages/${stageId}/playbook`),
  createStagePlaybook:  (stageId, data)   => apiFetch(`/stages/${stageId}/playbook`, { method: 'POST', body: JSON.stringify(data) }),
  updatePlaybook:       (orgId, id, data) => apiFetch(`/organizations/${orgId}/playbooks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deletePlaybook:       (orgId, id)       => apiFetch(`/organizations/${orgId}/playbooks/${id}`, { method: 'DELETE' }),
  aiAssistPlaybook:     (orgId, data)     => apiFetch(`/organizations/${orgId}/playbooks/ai-assist`, { method: 'POST', body: JSON.stringify(data) }),
}

// ─── Notifications API ──────────────────────────────────────────────────────

export const notificationsApi = {
  list: ({ cursor, unread_only, limit } = {}) => {
    const qs = new URLSearchParams()
    if (cursor)      qs.set('cursor', cursor)
    if (unread_only) qs.set('unread_only', unread_only)
    if (limit)       qs.set('limit', limit)
    return apiFetch(`/notifications?${qs.toString()}`)
  },
  markRead:            (id)     => apiFetch(`/notifications/${id}/read`, { method: 'PATCH' }),
  markReadBulk:        (filter) => apiFetch('/notifications/mark-read', { method: 'POST', body: JSON.stringify(filter) }),
  getPrefs:            ()       => apiFetch('/notification-preferences'),
  putPrefs:            (body)   => apiFetch('/notification-preferences', { method: 'PUT', body: JSON.stringify(body) }),
  listFailedDeliveries:()       => apiFetch('/notification-deliveries?status=failed'),
  retryDelivery:       (id)     => apiFetch(`/notification-deliveries/${id}/retry`, { method: 'POST' }),
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

// ─── Search v1 ──────────────────────────────────────────────────────────────

export const searchApi = {
  query: (filters = {}, opts = {}) => {
    const params = new URLSearchParams()
    if (filters.keyword)     params.set('keyword',     filters.keyword)
    if (filters.type_id)     params.set('type_id',     filters.type_id)
    if (filters.org_id)      params.set('org_id',      filters.org_id)
    if (filters.assignee_id) params.set('assignee_id', filters.assignee_id)
    if (filters.stage_class) params.set('stage_class', filters.stage_class)
    if (filters.priority)    params.set('priority',    filters.priority)
    if (opts.before)         params.set('before',      opts.before)
    if (opts.limit)          params.set('limit',       opts.limit)
    if (opts.include)        params.set('include',     opts.include.join(','))
    return apiFetch(`/search?${params.toString()}`)
  },
  fields: () => apiFetch('/search/fields'),
  translate: (prompt) => apiFetch('/search/translate', {
    method: 'POST', body: JSON.stringify({ prompt })
  }),
}

export const savedFiltersApi = {
  list: (scope = 'all', orgId = null) => {
    const p = new URLSearchParams({ scope })
    if (orgId) p.set('org_id', orgId)
    return apiFetch(`/saved-filters?${p.toString()}`)
  },
  get:    (id) => apiFetch(`/saved-filters/${id}`),
  create: (data) => apiFetch('/saved-filters', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => apiFetch(`/saved-filters/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  remove: (id) => apiFetch(`/saved-filters/${id}`, { method: 'DELETE' }),
}

// ─── Attachments API ─────────────────────────────────────────────────────────

export async function listAttachments(workItemId) {
  const r = await fetch(`/admin/api/work-items/${workItemId}/attachments`, { credentials: 'same-origin' })
  if (!r.ok) throw new Error(`listAttachments: ${r.status}`)
  return (await r.json()).attachments
}

export async function uploadAttachment(workItemId, file, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData()
    fd.append('file', file)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/admin/api/work-items/${workItemId}/attachments`)
    xhr.withCredentials = true
    if (onProgress) {
      xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable) onProgress(e.loaded / e.total)
      })
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText).attachment) }
        catch (e) { reject(e) }
      } else if (xhr.status === 413) {
        reject(new Error('File exceeds the maximum allowed size'))
      } else {
        reject(new Error(`uploadAttachment: ${xhr.status} ${xhr.responseText}`))
      }
    }
    xhr.onerror = () => reject(new Error('upload network error'))
    xhr.send(fd)
  })
}

export async function addLinkAttachment(workItemId, url, title) {
  const r = await fetch(`/admin/api/work-items/${workItemId}/attachments`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, title }),
  })
  if (!r.ok) throw new Error(`addLinkAttachment: ${r.status}`)
  return (await r.json()).attachment
}

export function attachmentDownloadUrl(workItemId, attachmentId) {
  return `/admin/api/work-items/${workItemId}/attachments/${attachmentId}/download`
}

export async function deleteAttachment(workItemId, attachmentId) {
  const r = await fetch(`/admin/api/work-items/${workItemId}/attachments/${attachmentId}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  if (!r.ok) throw new Error(`deleteAttachment: ${r.status}`)
  return (await r.json())
}

// ─── MCP Tool Reference ──────────────────────────────────────────────────────

export const mcpApi = {
  tools: () => apiFetch('/mcp/tools'),
}
