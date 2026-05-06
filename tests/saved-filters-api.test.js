import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { createAuthApi } from './helpers/auth.js'

const api = createAuthApi()
let createdId = null

describe('Saved filters CRUD', () => {
  after(async () => {
    if (createdId) await api(`/saved-filters/${createdId}`, { method: 'DELETE' })
  })

  it('creates a private filter', async () => {
    const r = await api('/saved-filters', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test private', jql: 'priority = 1', share_scope: 'private' })
    })
    assert.equal(r.status, 201)
    assert.ok(r.data.id)
    createdId = r.data.id
  })

  it('lists filters', async () => {
    const r = await api('/saved-filters')
    assert.equal(r.status, 200)
    assert.ok(Array.isArray(r.data.rows))
  })

  it('rejects bad JQL on save', async () => {
    const r = await api('/saved-filters', {
      method: 'POST',
      body: JSON.stringify({ name: 'Bad', jql: 'xyz === ===', share_scope: 'private' })
    })
    assert.equal(r.status, 400)
  })

  it('rejects org filter from non-member', async () => {
    const r = await api('/saved-filters', {
      method: 'POST',
      body: JSON.stringify({ name: 'Bad org', jql: 'priority = 1', share_scope: 'org', owner_org_id: 9999 })
    })
    assert.equal(r.status, 403)
  })

  it('updates a filter', async () => {
    if (!createdId) return
    const r = await api(`/saved-filters/${createdId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Test private (renamed)' })
    })
    assert.equal(r.status, 200)
    assert.equal(r.data.name, 'Test private (renamed)')
  })

  it('deletes a filter', async () => {
    if (!createdId) return
    const r = await api(`/saved-filters/${createdId}`, { method: 'DELETE' })
    assert.equal(r.status, 200)
    assert.equal(r.data.deleted, true)
    createdId = null
  })
})
