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

  // Work Item Types
  witTypes:          () => apiFetch('/work-item-types'),
  createWitType:     (data) => apiFetch('/work-item-types', { method: 'POST', body: JSON.stringify(data) }),
  updateWitType:     (id, data) => apiFetch(`/work-item-types/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Work Items
  workItems:         (limit = 50, offset = 0) => apiFetch(`/work-items?limit=${limit}&offset=${offset}`),

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
