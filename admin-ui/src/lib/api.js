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
  organizations:     () => apiFetch('/organizations'),
  workItems:         (limit = 50, offset = 0) => apiFetch(`/work-items?limit=${limit}&offset=${offset}`),
  workflows:         () => apiFetch('/workflows'),
  users:             () => apiFetch('/users'),
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
