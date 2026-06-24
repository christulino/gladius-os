import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { createAuthApi } from './helpers/auth.js'

const BASE = process.env.API_URL || 'http://localhost:3000'
const BEARER = process.env.GLADIUS_API_KEY || ''
const ORG_ID = 109
const WIT_TYPE_ID = 138
// Stage 638 = Discovery (has active playbook in dogfood)
// Stage 636 = Backlog (no playbook)

const api = createAuthApi()

async function bearerFetch(path, options = {}) {
  const res = await fetch(`${BASE}/admin/api${path}`, {
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${BEARER}`, ...options.headers },
    ...options,
  })
  return { status: res.status, data: await res.json() }
}

describe('MCP Playbook Read', () => {
  let workItemInBacklog

  before(async () => {
    // Create a test work item (will land in Backlog — entry stage)
    const { status, data } = await api('/work-items', {
      method: 'POST',
      body: JSON.stringify({ title: 'Playbook read test ' + Date.now(), work_item_type_id: WIT_TYPE_ID, owner_org_id: ORG_ID }),
    })
    assert.equal(status, 201, `create work item failed: ${JSON.stringify(data)}`)
    workItemInBacklog = data.id
  })

  it('returns 404 when no active playbook for current stage', async () => {
    // New items start in Backlog (stage 636) which has no playbook
    const { status } = await api(`/work-items/${workItemInBacklog}/stage-playbook`)
    assert.equal(status, 404, `expected 404 for Backlog stage (no playbook)`)
  })

  it('returns 404 for unknown work item', async () => {
    const { status } = await api('/work-items/999999999/stage-playbook')
    assert.equal(status, 404)
  })

  it('returns 200 with playbook content when active playbook exists', async () => {
    // Find a work item currently in Discovery (stage 638) — has active playbook in dogfood
    const { data: searchData } = await api('/search?stage_class=in-progress&org_id=' + ORG_ID + '&limit=10')
    const discovery = (searchData?.rows ?? []).filter(wi => wi.current_stage_name === 'Discovery' || wi.stage_name === 'Discovery')
    if (!discovery.length) {
      // No items in Discovery — skip the positive case
      console.log('  (skipping: no items in Discovery stage to test against)')
      return
    }
    const { status, data } = await api(`/work-items/${discovery[0].id}/stage-playbook`)
    assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(data)}`)
    assert.ok(data.id, 'missing id')
    assert.ok(data.content, 'missing content')
    assert.ok(typeof data.is_active === 'boolean', 'missing is_active')
  })

  it('returns playbook via Bearer auth', async () => {
    const { status } = await bearerFetch(`/work-items/${workItemInBacklog}/stage-playbook`)
    // 404 is correct (Backlog has no playbook), but NOT 401
    assert.notEqual(status, 401, 'Bearer auth should work')
  })
})
