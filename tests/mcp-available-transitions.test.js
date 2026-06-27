// tests/mcp-available-transitions.test.js
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createAuthApi } from './helpers/auth.js'
import { deleteWorkItems } from './helpers/cleanup.js'

const BASE = process.env.API_URL || 'http://localhost:3000'
const ORG_ID = 109
const WIT_TYPE_ID = 138  // Feature type in dogfood org

const api = createAuthApi()

describe('Available Transitions API', () => {
  let workItemId

  before(async () => {
    // Create a fresh work item — lands in Backlog (stage 636), which has outbound transitions
    const { status, data } = await api('/work-items', {
      method: 'POST',
      body: JSON.stringify({
        title: 'transitions test ' + Date.now(),
        work_item_type_id: WIT_TYPE_ID,
        owner_org_id: ORG_ID,
      }),
    })
    assert.equal(status, 201, `create work item failed: ${JSON.stringify(data)}`)
    workItemId = data.id
  })

  after(async () => {
    await deleteWorkItems([workItemId])
  })

  it('returns 200 with transitions array for a valid work item', async () => {
    const { status, data } = await api(`/work-items/${workItemId}/transitions`)
    assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(data)}`)
    assert.ok(Array.isArray(data.rows), 'expected data.rows to be an array')
    assert.ok(typeof data.count === 'number', 'expected data.count to be a number')
  })

  it('each transition row has the required fields', async () => {
    const { data } = await api(`/work-items/${workItemId}/transitions`)
    assert.ok(data.rows.length > 0, 'Backlog stage should have at least one outbound transition')
    for (const row of data.rows) {
      assert.ok(typeof row.to_stage_id    === 'number',  `missing to_stage_id: ${JSON.stringify(row)}`)
      assert.ok(typeof row.to_stage_name  === 'string',  `missing to_stage_name: ${JSON.stringify(row)}`)
      assert.ok(typeof row.to_stage_class === 'string',  `missing to_stage_class: ${JSON.stringify(row)}`)
      assert.ok(typeof row.is_terminal    === 'boolean', `missing is_terminal: ${JSON.stringify(row)}`)
      assert.ok('transition_label'  in row, `missing transition_label: ${JSON.stringify(row)}`)
      assert.ok('transition_kind'   in row, `missing transition_kind: ${JSON.stringify(row)}`)
      assert.ok('requires_reason'   in row, `missing requires_reason: ${JSON.stringify(row)}`)
    }
  })

  it('returns 404 for an unknown work item', async () => {
    const { status } = await api('/work-items/999999999/transitions')
    assert.equal(status, 404)
  })

  it('returns empty rows array for a terminal-stage item', async () => {
    // Find a done item in the dogfood org (terminal stage = no outbound transitions)
    const { data: searchData } = await api(`/search?stage_class=done&org_id=${ORG_ID}&limit=5`)
    const doneItems = searchData?.rows ?? []
    if (!doneItems.length) {
      console.log('  (skipping: no done items found in dogfood org)')
      return
    }
    const { status, data } = await api(`/work-items/${doneItems[0].id}/transitions`)
    assert.equal(status, 200)
    assert.deepEqual(data.rows, [], `expected empty rows for terminal item; got ${JSON.stringify(data.rows)}`)
  })

  it('returns 401 without auth', async () => {
    const res = await fetch(`${BASE}/admin/api/work-items/${workItemId}/transitions`)
    assert.equal(res.status, 401)
  })
})
