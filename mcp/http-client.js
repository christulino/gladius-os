// mcp/http-client.js
// Authenticated HTTP wrapper for the FlowOS REST API.
// Used by the MCP server to make all API calls via Bearer token instead of
// direct database access.

const API_KEY  = process.env.FLOWOS_API_KEY
const BASE_URL = process.env.FLOWOS_API_BASE_URL ?? 'http://localhost:3000'

if (!API_KEY) throw new Error('[flowos-mcp] FLOWOS_API_KEY env var is required')

const BASE_HEADERS = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
}

const MAX_RETRIES = 3

/**
 * Exponential backoff helper.
 * @param {number} attempt - Zero-based retry index (0 = first retry).
 * @returns {number} Delay in milliseconds.
 */
function backoffDelay(attempt) {
  return 100 * (2 ** attempt)
}

/**
 * Sleep for `ms` milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Core fetch wrapper with retry logic.
 * @param {string} url - Full URL to fetch.
 * @param {RequestInit} options - fetch options.
 * @param {number} [attempt=0] - Current attempt index (0-based).
 * @returns {Promise<unknown>} Parsed JSON response, or null on 404.
 */
async function request(url, options, attempt = 0) {
  const res = await fetch(url, options)

  if (res.ok) {
    const text = await res.text()
    return text ? JSON.parse(text) : null
  }

  const { status } = res

  if (status === 401 || status === 403) {
    // Never include the key itself in the error message
    throw new Error(`FlowOS API auth failed (${status}): check FLOWOS_API_KEY`)
  }

  if (status === 404) {
    return null
  }

  if (status === 429) {
    if (attempt >= MAX_RETRIES) {
      throw new Error(`FlowOS API rate limit exceeded after ${MAX_RETRIES} retries`)
    }
    const delay = backoffDelay(attempt)
    console.error(`[flowos-mcp] rate limited, retrying in ${delay}ms`)
    await sleep(delay)
    return request(url, options, attempt + 1)
  }

  if (status >= 500) {
    if (attempt >= MAX_RETRIES) {
      const body = await res.text()
      throw new Error(`FlowOS API server error (${status}) after ${MAX_RETRIES} retries: ${body}`)
    }
    const delay = backoffDelay(attempt)
    await sleep(delay)
    return request(url, options, attempt + 1)
  }

  // Other 4xx — throw immediately with status + body
  const body = await res.text()
  throw new Error(`FlowOS API error (${status}): ${body}`)
}

/**
 * Authenticated GET request.
 * @param {string} path - API path, e.g. '/admin/api/work-items/42'
 * @param {Record<string, string|number|boolean>} [params={}] - Query string params.
 * @returns {Promise<unknown>} Parsed JSON, or null on 404.
 */
export async function apiGet(path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value))
    }
  }
  return request(url.toString(), { method: 'GET', headers: BASE_HEADERS })
}

/**
 * Authenticated POST request.
 * @param {string} path - API path, e.g. '/admin/api/work-items'
 * @param {Record<string, unknown>} [body={}] - JSON request body.
 * @returns {Promise<unknown>} Parsed JSON, or null on 404.
 */
export async function apiPost(path, body = {}) {
  const url = `${BASE_URL}${path}`
  return request(url, {
    method: 'POST',
    headers: BASE_HEADERS,
    body: JSON.stringify(body),
  })
}

/**
 * Names of MCP tools that perform write operations.
 * Used by the rate limiter (Task 4) to apply stricter limits.
 */
export const WRITE_TOOLS = new Set(['write_context_entry', 'add_comment', 'transition_work_item'])
