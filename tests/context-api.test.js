// tests/context-api.test.js
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createAuthApi } from './helpers/auth.js'
import { createTestOrg } from './helpers/testOrg.js'

const api = createAuthApi()

// Ephemeral org provisioned once for the whole test file; torn down in after().
let testOrg
before(async () => { testOrg = await createTestOrg() })
after(async ()  => { await testOrg.teardown() })

describe('Context Entries API', () => {
  let workItemId

  before(async () => {
    const { data: wi } = await api('/work-items', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Context Test Item ' + Date.now(),
        work_item_type_id: testOrg.typeId,
        owner_org_id: testOrg.orgId,
      }),
    })
    workItemId = wi.id
    assert.ok(workItemId, 'Need a work item')
  })

  let entryId

  it('should return empty journal', async () => {
    const { status, data } = await api(`/work-items/${workItemId}/context-entries`)
    assert.equal(status, 200)
    assert.ok(Array.isArray(data.rows))
  })

  it('should create a context entry', async () => {
    const { status, data } = await api(`/work-items/${workItemId}/context-entries`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'discovery',
        title: 'Initial discovery',
        content: '## Notes\n\nUser reported timeout without warning.',
        visibility: 'descendants',
        tags: ['ux', 'timeout'],
      }),
    })
    assert.equal(status, 201)
    assert.ok(data.id)
    assert.equal(data.type, 'discovery')
    assert.equal(data.visibility, 'descendants')
    entryId = data.id
  })

  it('should list the entry', async () => {
    const { data } = await api(`/work-items/${workItemId}/context-entries`)
    const found = data.rows.find(e => e.id === entryId)
    assert.ok(found, 'Entry should appear in list')
    assert.equal(found.type, 'discovery')
  })

  it('should update a context entry', async () => {
    const { status, data } = await api(
      `/work-items/${workItemId}/context-entries/${entryId}`,
      { method: 'PATCH', body: JSON.stringify({ content: '## Notes\n\nUpdated.' }) }
    )
    assert.equal(status, 200)
    assert.equal(data.is_edited, true)
    assert.ok(data.content.includes('Updated'))
  })

  it('should reject PATCH via wrong work item (IDOR)', async () => {
    // Create a fresh entry to test against
    const { data: e } = await api(`/work-items/${workItemId}/context-entries`, {
      method: 'POST',
      body: JSON.stringify({ type: 'note', content: 'IDOR test entry' }),
    })
    // Attempt to PATCH it via a different (non-existent) work item ID
    const { status } = await api(
      `/work-items/999999/context-entries/${e.id}`,
      { method: 'PATCH', body: JSON.stringify({ content: 'Hijacked.' }) }
    )
    assert.equal(status, 404)
    // Clean up
    await api(`/work-items/${workItemId}/context-entries/${e.id}`, { method: 'DELETE' })
  })

  it('should reject an unknown entry type', async () => {
    const { status, data } = await api(`/work-items/${workItemId}/context-entries`, {
      method: 'POST',
      body: JSON.stringify({ type: 'bogus', content: 'Should not be stored.' }),
    })
    assert.equal(status, 400, `Expected 400 for invalid type, got ${status}`)
    assert.ok(data.error, 'Response should include an error message')
    assert.ok(data.error.includes('bogus'), `Error should mention the bad type; got: ${data.error}`)
  })

  it('should delete a context entry', async () => {
    const { status, data } = await api(
      `/work-items/${workItemId}/context-entries/${entryId}`,
      { method: 'DELETE' }
    )
    assert.equal(status, 200)
    assert.equal(data.deleted, true)
  })
})
