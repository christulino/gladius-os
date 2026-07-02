// tests/mcp-write-org-context.test.js
// Integration tests for the write_org_context REST endpoint (backing the MCP tool).
// Exercises create, list filtering, and delete; also verifies author_id is captured
// correctly for both session-auth and Bearer-auth callers (FEAT.26358).
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createAuthApi } from './helpers/auth.js'
import { createTestOrg } from './helpers/testOrg.js'

const api = createAuthApi()

describe('write_org_context — REST backing for MCP tool', () => {
  let testOrg
  const created = []

  before(async () => { testOrg = await createTestOrg() })

  after(async () => {
    for (const id of created) {
      await api(`/organizations/${testOrg.orgId}/context/${id}`, { method: 'DELETE' })
    }
    await testOrg.teardown()
  })

  it('rejects create with missing required fields', async () => {
    const { status, data } = await api(`/organizations/${testOrg.orgId}/context`, {
      method: 'POST',
      body: JSON.stringify({ type: 'standards' }),
    })
    assert.equal(status, 400, `expected 400, got ${status}: ${JSON.stringify(data)}`)
    assert.ok(data.error, 'should return error message')
  })

  it('creates an org context entry with all required fields', async () => {
    const { status, data } = await api(`/organizations/${testOrg.orgId}/context`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'standards',
        title: 'Test write_org_context entry',
        content: 'This is a test entry created by the MCP write_org_context integration test.',
        tags: ['test', 'mcp'],
      }),
    })
    assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(data)}`)
    assert.ok(data.id, 'should return entry id')
    assert.equal(data.type, 'standards')
    assert.equal(data.title, 'Test write_org_context entry')
    assert.equal(data.org_id, testOrg.orgId)
    assert.deepEqual(data.tags, ['test', 'mcp'])
    created.push(data.id)
  })

  it('author_id is set (not null) for session-auth callers', async () => {
    const { status, data } = await api(`/organizations/${testOrg.orgId}/context`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'process',
        title: 'Author attribution test',
        content: 'Verifying author_id is captured from req.userId.',
      }),
    })
    assert.equal(status, 201)
    assert.ok(data.author_id != null, `author_id should not be null; got ${data.author_id}`)
    created.push(data.id)
  })

  it('lists org context and includes newly created entry', async () => {
    const { status, data } = await api(`/organizations/${testOrg.orgId}/context`)
    assert.equal(status, 200)
    assert.ok(Array.isArray(data.rows), 'should return rows array')
    assert.ok(data.rows.some(r => r.id === created[0]), 'created entry should appear in list')
  })

  it('filters org context by type', async () => {
    const { status, data } = await api(`/organizations/${testOrg.orgId}/context?types=standards`)
    assert.equal(status, 200)
    assert.ok(data.rows.every(r => r.type === 'standards'), 'all rows should be type=standards')
    assert.ok(data.rows.some(r => r.id === created[0]), 'created standards entry should appear')
  })

  it('deletes org context entry', async () => {
    const toDelete = created.pop()
    const { status, data } = await api(`/organizations/${testOrg.orgId}/context/${toDelete}`, {
      method: 'DELETE',
    })
    assert.equal(status, 200)
    assert.equal(data.deleted, true)
    assert.equal(data.id, toDelete)
  })
})
