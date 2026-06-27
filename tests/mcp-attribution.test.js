import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createAuthApi } from './helpers/auth.js'
import { deleteWorkItems } from './helpers/cleanup.js'
import { TOOLS } from '../mcp/toolsManifest.js'

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

  after(async () => {
    await deleteWorkItems([workItemId])
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

  it('persists the requested entry type unchanged', async () => {
    if (skipBearer) return
    const { status, data } = await bearerFetch(`/work-items/${workItemId}/context-entries`, {
      method: 'POST',
      body: JSON.stringify({ type: 'discovery', content: 'type fidelity', title: 'Type check' }),
    })
    assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(data)}`)
    assert.equal(data.type, 'discovery', `persisted type should be 'discovery', got '${data.type}'`)
  })
})

describe('MCP Tool Schema', () => {
  it('write_context_entry exposes entry_type (not type) as the parameter name', () => {
    const tool = TOOLS.find(t => t.name === 'write_context_entry')
    assert.ok(tool, 'write_context_entry tool not found in manifest')
    const props = tool.inputSchema.properties
    assert.ok('entry_type' in props, 'write_context_entry schema must have entry_type property')
    assert.ok(!('type' in props), 'write_context_entry schema must not expose type — use entry_type')
    assert.ok(tool.inputSchema.required.includes('entry_type'), 'entry_type must be required')
  })
})
