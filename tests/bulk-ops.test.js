// tests/bulk-ops.test.js
//
// Integration tests for bulk work-item operations.
//
// Covers:
//   1. Happy path bulk transition (all items succeed)
//   2. Partial-success bulk transition (some items blocked by unmet exit criteria)
//   3. Happy path bulk assign
//   4. Input validation for both endpoints

import { describe, it, before, after } from 'node:test'
import { closePool } from './helpers/poolTeardown.js'
import assert from 'node:assert/strict'
import { createAuthApi } from './helpers/auth.js'
import { createTestOrg } from './helpers/testOrg.js'

const api = createAuthApi()

// Ephemeral org provisioned once for the whole test file; torn down in after().
let testOrg
before(async () => { testOrg = await createTestOrg() })
after(async ()  => { await testOrg.teardown() })

// Helper: create a work item in the ephemeral test org, return the full item object.
async function createItem(suffix = '') {
  const { status, data } = await api('/work-items', {
    method: 'POST',
    body: JSON.stringify({
      title: `bulk-ops test ${suffix} ${Date.now()}`,
      work_item_type_id: testOrg.typeId,
      owner_org_id: testOrg.orgId,
    }),
  })
  assert.equal(status, 201, `createItem failed (${suffix}): ${JSON.stringify(data)}`)
  return data
}

// ─── Happy-path bulk transition ───────────────────────────────────────────────

describe('Bulk Transition — all succeed', () => {
  let itemIds = []
  let toStageId

  before(async () => {
    const items = await Promise.all([0, 1, 2].map(i => createItem(`happy-${i}`)))
    itemIds = items.map(wi => wi.id)

    // Discover the first outbound transition from the entry stage
    const { data: tx } = await api(`/work-items/${itemIds[0]}/transitions`)
    assert.ok(tx.rows.length > 0, 'Entry stage should have at least one outbound transition')
    toStageId = tx.rows[0].to_stage_id
  })

  it('returns 200 with results array', async () => {
    const { status, data } = await api('/work-items/bulk/transition', {
      method: 'POST',
      body: JSON.stringify({ work_item_ids: itemIds, to_stage_id: toStageId }),
    })
    assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(data)}`)
    assert.ok(Array.isArray(data.results), 'results should be an array')
    assert.equal(data.results.length, itemIds.length)
  })

  it('all items succeed', async () => {
    // Re-run on same items — they're already in toStage, so now we need to check
    // they moved. The test above already ran; let's verify via the counts returned
    // in that same response. Re-run a fresh batch here for cleaner isolation.
    const items = await Promise.all([0, 1].map(i => createItem(`happy2-${i}`)))
    const ids   = items.map(wi => wi.id)

    const { data } = await api('/work-items/bulk/transition', {
      method: 'POST',
      body: JSON.stringify({ work_item_ids: ids, to_stage_id: toStageId }),
    })
    assert.equal(data.succeeded_count, ids.length, `Expected ${ids.length} succeeded`)
    assert.equal(data.failed_count, 0)
    for (const r of data.results) {
      assert.equal(r.success, true, `Item ${r.id} should succeed`)
      assert.ok(!r.error, 'Successful result should have no error')
    }
  })

  it('response includes succeeded_count and failed_count', async () => {
    const item = await createItem('count-check')
    const { data } = await api('/work-items/bulk/transition', {
      method: 'POST',
      body: JSON.stringify({ work_item_ids: [item.id], to_stage_id: toStageId }),
    })
    assert.equal(typeof data.succeeded_count, 'number')
    assert.equal(typeof data.failed_count, 'number')
    assert.equal(data.succeeded_count + data.failed_count, data.results.length)
  })
})

// ─── Partial-success bulk transition ─────────────────────────────────────────
//
// A manual blocking exit criterion is added to the items' entry stage.
// Two of the three items have it acknowledged; the third does not.
// The criterion is soft-deleted in after() to restore normal stage behavior.

describe('Bulk Transition — partial success (unmet exit criteria)', () => {
  let itemIds   = []
  let toStageId
  let criterionId
  let fromStageId

  before(async () => {
    const items = await Promise.all([0, 1, 2].map(i => createItem(`partial-${i}`)))
    itemIds     = items.map(wi => wi.id)
    fromStageId = items[0].current_stage_id

    // Discover outbound transition
    const { data: tx } = await api(`/work-items/${itemIds[0]}/transitions`)
    assert.ok(tx.rows.length > 0, 'Entry stage should have at least one outbound transition')
    toStageId = tx.rows[0].to_stage_id

    // Create a blocking manual exit criterion on the entry stage
    const { status: cs, data: crit } = await api('/exit-criteria', {
      method: 'POST',
      body: JSON.stringify({
        stage_id:      fromStageId,
        name:          `bulk-ops partial-success criterion ${Date.now()}`,
        criteria_tier: 'manual',
        is_blocking:   true,
      }),
    })
    assert.equal(cs, 201, `Failed to create exit criterion: ${JSON.stringify(crit)}`)
    criterionId = crit.id

    // Acknowledge the criterion for the first two items only (third stays unmet)
    for (const id of itemIds.slice(0, 2)) {
      const { status: as } = await api(
        `/work-items/${id}/exit-criteria/${criterionId}/acknowledge`,
        { method: 'POST' },
      )
      assert.ok(as < 300, `Acknowledge failed for item ${id}`)
    }
  })

  after(async () => {
    // Soft-delete the criterion to restore normal stage exit behavior for this org
    if (criterionId) {
      await api(`/exit-criteria/${criterionId}`, { method: 'DELETE' })
    }
  })

  it('returns 200 (partial success is not an HTTP error)', async () => {
    const { status } = await api('/work-items/bulk/transition', {
      method: 'POST',
      body: JSON.stringify({ work_item_ids: itemIds, to_stage_id: toStageId }),
    })
    assert.equal(status, 200)
  })

  it('2 succeed and 1 fails due to unmet exit criteria', async () => {
    // Re-create fresh items so this test is self-contained even if run alone
    const freshItems = await Promise.all([0, 1, 2].map(i => createItem(`partial2-${i}`)))
    const freshIds   = freshItems.map(wi => wi.id)

    // Acknowledge criterion for first two fresh items
    for (const id of freshIds.slice(0, 2)) {
      await api(`/work-items/${id}/exit-criteria/${criterionId}/acknowledge`, { method: 'POST' })
    }

    const { status, data } = await api('/work-items/bulk/transition', {
      method: 'POST',
      body: JSON.stringify({ work_item_ids: freshIds, to_stage_id: toStageId }),
    })
    assert.equal(status, 200)
    assert.equal(data.succeeded_count, 2, `Expected 2 succeeded, got ${data.succeeded_count}`)
    assert.equal(data.failed_count,    1, `Expected 1 failed, got ${data.failed_count}`)
  })

  it('failed result includes an error message', async () => {
    // Create one item with unmet criterion and try to transition it
    const item = await createItem('partial-err-msg')
    // Do NOT acknowledge — criterion is still active on from stage

    const { data } = await api('/work-items/bulk/transition', {
      method: 'POST',
      body: JSON.stringify({ work_item_ids: [item.id], to_stage_id: toStageId }),
    })
    assert.equal(data.results.length, 1)
    const r = data.results[0]
    assert.equal(r.success, false)
    assert.ok(r.error, 'Failed result should include an error string')
    assert.equal(typeof r.error, 'string')
  })

  it('succeeded results have no error field', async () => {
    const item = await createItem('partial-success-check')
    await api(`/work-items/${item.id}/exit-criteria/${criterionId}/acknowledge`, { method: 'POST' })

    const { data } = await api('/work-items/bulk/transition', {
      method: 'POST',
      body: JSON.stringify({ work_item_ids: [item.id], to_stage_id: toStageId }),
    })
    assert.equal(data.results.length, 1)
    const r = data.results[0]
    assert.equal(r.success, true)
    assert.ok(!r.error, 'Successful result should have no error')
  })
})

// ─── Happy-path bulk assign ───────────────────────────────────────────────────

describe('Bulk Assign — all succeed', () => {
  let itemIds = []
  let userId

  before(async () => {
    const items = await Promise.all([0, 1].map(i => createItem(`assign-${i}`)))
    itemIds = items.map(wi => wi.id)

    const { data: users } = await api('/users')
    assert.ok(users.rows.length > 0, 'Need at least one user in the system')
    userId = users.rows[0].id
  })

  it('returns 200 with results array', async () => {
    const { status, data } = await api('/work-items/bulk/assign', {
      method: 'POST',
      body: JSON.stringify({
        work_item_ids:     itemIds,
        user_id:           userId,
        relationship_type: 'assignee',
      }),
    })
    assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(data)}`)
    assert.ok(Array.isArray(data.results))
    assert.equal(data.results.length, itemIds.length)
  })

  it('all items succeed', async () => {
    const items = await Promise.all([0, 1, 2].map(i => createItem(`assign2-${i}`)))
    const ids   = items.map(wi => wi.id)

    const { data } = await api('/work-items/bulk/assign', {
      method: 'POST',
      body: JSON.stringify({
        work_item_ids:     ids,
        user_id:           userId,
        relationship_type: 'assignee',
      }),
    })
    assert.equal(data.succeeded_count, ids.length)
    assert.equal(data.failed_count, 0)
    for (const r of data.results) {
      assert.equal(r.success, true, `Item ${r.id} should succeed`)
    }
  })

  it('is idempotent — assigning same user twice does not error', async () => {
    const item = await createItem('assign-idempotent')

    const body = JSON.stringify({
      work_item_ids:     [item.id],
      user_id:           userId,
      relationship_type: 'assignee',
    })
    // First assignment
    const { data: first } = await api('/work-items/bulk/assign', { method: 'POST', body })
    assert.equal(first.results[0].success, true)

    // Second assignment — ON CONFLICT DO NOTHING; still success
    const { data: second } = await api('/work-items/bulk/assign', { method: 'POST', body })
    assert.equal(second.results[0].success, true, 'Re-assigning the same user should be idempotent')
  })
})

// ─── Input validation ────────────────────────────────────────────────────────

describe('Bulk ops — input validation', () => {

  // ── bulk/transition ──

  it('bulk/transition: 400 when work_item_ids is missing', async () => {
    const { status, data } = await api('/work-items/bulk/transition', {
      method: 'POST',
      body: JSON.stringify({ to_stage_id: 637 }),
    })
    assert.equal(status, 400)
    assert.ok(data.error, 'Response should include error message')
  })

  it('bulk/transition: 400 when work_item_ids is an empty array', async () => {
    const { status, data } = await api('/work-items/bulk/transition', {
      method: 'POST',
      body: JSON.stringify({ work_item_ids: [], to_stage_id: 637 }),
    })
    assert.equal(status, 400)
    assert.ok(data.error)
  })

  it('bulk/transition: 400 when to_stage_id is missing', async () => {
    const { status, data } = await api('/work-items/bulk/transition', {
      method: 'POST',
      body: JSON.stringify({ work_item_ids: [1, 2, 3] }),
    })
    assert.equal(status, 400)
    assert.ok(data.error)
  })

  // ── bulk/assign ──

  it('bulk/assign: 400 when work_item_ids is missing', async () => {
    const { status, data } = await api('/work-items/bulk/assign', {
      method: 'POST',
      body: JSON.stringify({ user_id: 1, relationship_type: 'assignee' }),
    })
    assert.equal(status, 400)
    assert.ok(data.error)
  })

  it('bulk/assign: 400 when work_item_ids is an empty array', async () => {
    const { status, data } = await api('/work-items/bulk/assign', {
      method: 'POST',
      body: JSON.stringify({ work_item_ids: [], user_id: 1, relationship_type: 'assignee' }),
    })
    assert.equal(status, 400)
    assert.ok(data.error)
  })

  it('bulk/assign: 400 when user_id is missing', async () => {
    const { status, data } = await api('/work-items/bulk/assign', {
      method: 'POST',
      body: JSON.stringify({ work_item_ids: [1, 2], relationship_type: 'assignee' }),
    })
    assert.equal(status, 400)
    assert.ok(data.error)
  })

  it('bulk/assign: 400 when relationship_type is missing', async () => {
    const { status, data } = await api('/work-items/bulk/assign', {
      method: 'POST',
      body: JSON.stringify({ work_item_ids: [1, 2], user_id: 1 }),
    })
    assert.equal(status, 400)
    assert.ok(data.error)
  })

  it('bulk/assign: 404 when user does not exist', async () => {
    const item = await createItem('assign-404-user')
    const { status, data } = await api('/work-items/bulk/assign', {
      method: 'POST',
      body: JSON.stringify({
        work_item_ids:     [item.id],
        user_id:           999999999,
        relationship_type: 'assignee',
      }),
    })
    assert.equal(status, 404)
    assert.ok(data.error)
  })
})

// Close the shared PG pool so this test process can exit cleanly (DEBT.26643).
after(closePool)
