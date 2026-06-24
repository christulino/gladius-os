import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { createAuthApi } from './helpers/auth.js'

const BASE = process.env.API_URL || 'http://localhost:3000'
const BEARER = process.env.GLADIUS_API_KEY || ''
const AGENT_USER_ID = parseInt(process.env.GLADIUS_AGENT_USER_ID || '0', 10)
const ORG_ID = parseInt(process.env.GLADIUS_TEST_ORG_ID || '109', 10)
const WIT_TYPE_ID = parseInt(process.env.GLADIUS_TEST_WIT_TYPE_ID || '138', 10)

const api = createAuthApi()

async function bearerFetch(path, options = {}) {
  const res = await fetch(`${BASE}/admin/api${path}`, {
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${BEARER}`, ...options.headers },
    ...options,
  })
  return { status: res.status, data: await res.json() }
}

describe('MCP Attribution', () => {
  let workItemId

  // Skip Bearer-specific tests when no API key is configured
  const skipBearer = !BEARER || !AGENT_USER_ID

  before(async () => {
    const { status, data } = await api('/work-items', {
      method: 'POST',
      body: JSON.stringify({ title: 'Attribution test ' + Date.now(), work_item_type_id: WIT_TYPE_ID, owner_org_id: ORG_ID }),
    })
    assert.equal(status, 201, `create work item failed: ${JSON.stringify(data)}`)
    workItemId = data.id
  })

  it('sets author_id from Bearer token caller', async () => {
    if (skipBearer) return
    const { status, data } = await bearerFetch(`/work-items/${workItemId}/context-entries`, {
      method: 'POST',
      body: JSON.stringify({ type: 'note', content: 'bearer auth test' }),
    })
    assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(data)}`)
    assert.equal(data.author_id, AGENT_USER_ID, `expected author_id=${AGENT_USER_ID}, got ${data.author_id}`)
  })

  it('stores title from request body', async () => {
    if (skipBearer) return
    const { status, data } = await bearerFetch(`/work-items/${workItemId}/context-entries`, {
      method: 'POST',
      body: JSON.stringify({ type: 'note', content: 'title test', title: 'My custom title' }),
    })
    assert.equal(status, 201)
    assert.equal(data.title, 'My custom title')
  })

  it('session auth still sets author_id', async () => {
    const { status, data } = await api(`/work-items/${workItemId}/context-entries`, {
      method: 'POST',
      body: JSON.stringify({ type: 'note', content: 'session auth test' }),
    })
    assert.equal(status, 201)
    assert.ok(data.author_id !== null, `session auth should set author_id, got null`)
  })
})
