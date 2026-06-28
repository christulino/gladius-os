import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createAuthApi } from './helpers/auth.js'
import { createTestOrg } from './helpers/testOrg.js'

const api = createAuthApi()

// Ephemeral org provisioned once for the whole test file; torn down in after().
let testOrg
before(async () => { testOrg = await createTestOrg() })
after(async ()  => { await testOrg.teardown() })

describe('Work item history (audit trail)', () => {
  let workItemId
  let userId

  before(async () => {
    const { data: wi } = await api('/work-items', {
      method: 'POST',
      body: JSON.stringify({
        title: 'History Test ' + Date.now(),
        work_item_type_id: testOrg.typeId,
        owner_org_id:      testOrg.orgId,
      }),
    })
    workItemId = wi.id
    assert.ok(workItemId, 'Should create work item')

    // Pick any non-system user to assign — the test account or first available
    const { data: users } = await api('/users')
    const candidate = users.rows.find(u => !u.is_system && u.is_active)
    userId = candidate?.id
    assert.ok(userId, 'Should find a user to assign')
  })

  it('returns 404 for unknown work item', async () => {
    const { status } = await api('/work-items/999999999/history')
    assert.equal(status, 404)
  })

  it('returns the creation event for a brand-new item', async () => {
    const { status, data } = await api(`/work-items/${workItemId}/history`)
    assert.equal(status, 200)
    assert.ok(Array.isArray(data.rows), 'rows should be an array')
    assert.equal(data.rows.length, 1, 'expected 1 history entry (created)')
    assert.equal(data.rows[0].event_type, 'work_item.created')
    assert.match(data.rows[0].summary, /created/)
  })

  it('records a multi-field edit as a single edited entry with expanded changes', async () => {
    const { status: patchStatus } = await api(`/work-items/${workItemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'History Test (renamed)', priority: 2 }),
    })
    assert.equal(patchStatus, 200)

    const { data } = await api(`/work-items/${workItemId}/history`)
    assert.equal(data.rows.length, 2, 'expected 2 entries (edited + created)')

    const edited = data.rows[0]
    assert.equal(edited.event_type, 'work_item.edited', 'newest first')
    assert.ok(Array.isArray(edited.details?.changes), 'edited should expose changes[]')
    assert.equal(edited.details.changes.length, 2, 'both fields recorded')
    const fields = new Set(edited.details.changes.map(c => c.field))
    assert.ok(fields.has('title'),    'title change present')
    assert.ok(fields.has('priority'), 'priority change present')
  })

  it('records an assignment with the assigned user name in the summary', async () => {
    const { status: relStatus } = await api(`/work-items/${workItemId}/relationships`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, relationship_type: 'owns' }),
    })
    assert.equal(relStatus, 201)

    const { data } = await api(`/work-items/${workItemId}/history`)
    assert.equal(data.rows.length, 3, 'expected 3 entries (assigned + edited + created)')
    const assigned = data.rows[0]
    assert.equal(assigned.event_type, 'work_item.assigned')
    assert.match(assigned.summary, /added .* as owns/, 'summary names assignee + relationship')
  })

  it('returns chronologically descending order by event id', async () => {
    const { data } = await api(`/work-items/${workItemId}/history`)
    for (let i = 1; i < data.rows.length; i++) {
      assert.ok(
        data.rows[i - 1].id > data.rows[i].id,
        `row ${i - 1} (id=${data.rows[i - 1].id}) should sort before row ${i} (id=${data.rows[i].id})`
      )
    }
  })

  it('honors the limit parameter', async () => {
    const { data } = await api(`/work-items/${workItemId}/history?limit=1`)
    assert.equal(data.rows.length, 1)
    assert.ok(data.next_before, 'next_before cursor should be returned when results are truncated')
  })

  it('paginates via the before cursor', async () => {
    const { data: page1 } = await api(`/work-items/${workItemId}/history?limit=1`)
    const { data: page2 } = await api(`/work-items/${workItemId}/history?limit=1&before=${page1.next_before}`)
    assert.equal(page2.rows.length, 1)
    assert.notEqual(page2.rows[0].id, page1.rows[0].id, 'second page returns a different event')
    assert.ok(page2.rows[0].id < page1.rows[0].id, 'second page is older')
  })
})
