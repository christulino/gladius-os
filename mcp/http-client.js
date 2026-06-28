// mcp/http-client.js
const API_KEY  = process.env.GLADIUS_API_KEY
const BASE_URL = process.env.GLADIUS_API_BASE_URL ?? 'http://localhost:3000'

if (!API_KEY) throw new Error('[gladius-mcp] GLADIUS_API_KEY env var is required')

const BASE_HEADERS = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
}

const MAX_RETRIES = 3

function backoffDelay(attempt) {
  return 100 * (2 ** attempt)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function request(url, options, attempt = 0) {
  const res = await fetch(url, options)

  if (res.ok) {
    const text = await res.text()
    return text ? JSON.parse(text) : null
  }

  const { status } = res

  if (status === 401 || status === 403) {
    throw new Error(`Gladius API auth failed (${status}): check GLADIUS_API_KEY`)
  }

  if (status === 404) {
    return null
  }

  if (status === 429) {
    if (attempt >= MAX_RETRIES) {
      throw new Error(`Gladius API rate limit exceeded after ${MAX_RETRIES} retries`)
    }
    const delay = backoffDelay(attempt)
    console.error(`[gladius-mcp] rate limited, retrying in ${delay}ms`)
    await sleep(delay)
    return request(url, options, attempt + 1)
  }

  if (status >= 500) {
    if (attempt >= MAX_RETRIES) {
      const body = await res.text()
      throw new Error(`Gladius API server error (${status}) after ${MAX_RETRIES} retries: ${body}`)
    }
    const delay = backoffDelay(attempt)
    await sleep(delay)
    return request(url, options, attempt + 1)
  }

  const body = await res.text()
  throw new Error(`Gladius API error (${status}): ${body}`)
}

export async function apiGet(path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value))
    }
  }
  return request(url.toString(), { method: 'GET', headers: BASE_HEADERS })
}

export async function apiPost(path, body = {}) {
  const url = `${BASE_URL}${path}`
  return request(url, {
    method: 'POST',
    headers: BASE_HEADERS,
    body: JSON.stringify(body),
  })
}

export async function apiPatch(path, body = {}) {
  const url = `${BASE_URL}${path}`
  return request(url, {
    method: 'PATCH',
    headers: BASE_HEADERS,
    body: JSON.stringify(body),
  })
}

export async function apiDelete(path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value))
    }
  }
  return request(url.toString(), { method: 'DELETE', headers: BASE_HEADERS })
}

export const WRITE_TOOLS = new Set([
  'write_context_entry', 'write_org_context', 'add_comment', 'transition_work_item',
  'set_work_item_fields', 'ack_exit_criterion', 'link_work_items', 'unlink_work_items',
])
