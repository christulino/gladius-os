// tests/mcp-available-transitions.test.js
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createAuthApi } from './helpers/auth.js'
import { createTestOrg } from './helpers/testOrg.js'

const BASE = process.env.API_URL || 'http://localhost:3000'

const api = createAuthApi()

describe('Available Transitions API', () => {
  let testOrg
  let workItemId

  before(async () => {
    testOrg = await createTestOrg()

    // Create a fresh work item — lands in the Task type's entry stage (Inbox),
    // which has outbound transitions (Start, Cancel)
    const { status, data } = await api('/work-items', {
      method: 'POST',
      body: JSON.stringify({
        title: 'transitions test ' + Date.now(),
        work_item_type_id: testOrg.typeId,
        owner_org_id: testOrg.orgId,
      }),
    })
    assert.equal(status, 201, `create work item failed: ${JSON.stringify(data)}`)
    workItemId = data.id
  })

  after(async () => {
    await testOrg.teardown()
  })

  it('returns 200 with transitions array for a valid work item', async () => {
    const { status, data } = await api(`/work-items/${workItemId}/transitions`)
    assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(data)}`)
    assert.ok(Array.isArray(data.rows), 'expected data.rows to be an array')
    assert.ok(typeof data.count === 'number', 'expected data.count to be a number')
  })

  it('each transition row has the required fields', async () => {
    const { data } = await api(`/work-items/${workItemId}/transitions`)
    assert.ok(data.rows.length > 0, 'entry stage should have at least one outbound transition')
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
    // Drive our own item to a terminal stage (Done) instead of hunting through
    // the dogfood board for one — keeps this test fully within the ephemeral org.
    const { data: transitions } = await api(`/work-items/${workItemId}/transitions`)
    const startTransition = transitions.rows.find(t => t.to_stage_class === 'in-progress')
    assert.ok(startTransition, 'expected a transition into an in-progress stage')

    const { status: s1 } = await api(`/work-items/${workItemId}/transition`, {
      method: 'POST',
      body: JSON.stringify({ to_stage_id: startTransition.to_stage_id }),
    })
    assert.equal(s1, 200, 'transition to in-progress should succeed')

    const { data: transitions2 } = await api(`/work-items/${workItemId}/transitions`)
    const doneTransition = transitions2.rows.find(t => t.to_stage_class === 'done')
    assert.ok(doneTransition, 'expected a transition into a done stage')

    const { status: s2 } = await api(`/work-items/${workItemId}/transition`, {
      method: 'POST',
      body: JSON.stringify({ to_stage_id: doneTransition.to_stage_id }),
    })
    assert.equal(s2, 200, 'transition to done should succeed')

    const { status, data } = await api(`/work-items/${workItemId}/transitions`)
    assert.equal(status, 200)
    assert.deepEqual(data.rows, [], `expected empty rows for terminal item; got ${JSON.stringify(data.rows)}`)
  })

  it('returns 401 without auth', async () => {
    const res = await fetch(`${BASE}/admin/api/work-items/${workItemId}/transitions`)
    assert.equal(res.status, 401)
  })
})
