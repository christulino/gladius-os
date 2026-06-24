// tests/session-context-api.test.js
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { createAuthApi } from './helpers/auth.js'

const api = createAuthApi()

describe('Session Context API', () => {
  let orgId

  before(async () => {
    const { data } = await api('/organizations')
    assert.ok(data.rows.length > 0, 'Need at least one org')
    orgId = data.rows[0].id
  })

  it('returns 200 with expected shape', async () => {
    const { status, data } = await api(`/organizations/${orgId}/session-context`)
    assert.equal(status, 200)
    assert.ok(Array.isArray(data.active),         'active must be array')
    assert.ok(Array.isArray(data.queued),          'queued must be array')
    assert.ok(Array.isArray(data.recently_done),   'recently_done must be array')
    assert.ok(Array.isArray(data.open_decisions),  'open_decisions must be array')
  })

  it('active items have required fields', async () => {
    const { data } = await api(`/organizations/${orgId}/session-context`)
    for (const item of data.active) {
      assert.ok(item.id,          'active item missing id')
      assert.ok(item.display_key, 'active item missing display_key')
      assert.ok(item.title,       'active item missing title')
      assert.ok(item.stage_name,  'active item missing stage_name')
      assert.ok(item.type_name,   'active item missing type_name')
    }
  })

  it('open_decisions link back to a work item', async () => {
    const { data } = await api(`/organizations/${orgId}/session-context`)
    for (const d of data.open_decisions) {
      assert.ok(d.work_item_id,    'decision missing work_item_id')
      assert.ok(d.work_item_title, 'decision missing work_item_title')
      assert.ok(d.display_key,     'decision missing display_key')
    }
  })

  it('returns 401 without auth', async () => {
    const res = await fetch(`http://localhost:3000/admin/api/organizations/${orgId}/session-context`)
    assert.equal(res.status, 401)
  })

  it('returns 400 for invalid org id', async () => {
    const { status } = await api('/organizations/notanumber/session-context')
    assert.equal(status, 400)
  })
})
