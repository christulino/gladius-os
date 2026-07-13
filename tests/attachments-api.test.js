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

describe('Attachments API', () => {
  let workItemId

  before(async () => {
    const { data: wi } = await api('/work-items', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Attachment Test Item ' + Date.now(),
        work_item_type_id: testOrg.typeId,
        owner_org_id: testOrg.orgId,
      }),
    })
    assert.ok(wi.id, 'Should create work item for attachments test')
    workItemId = wi.id
  })

  it('lists attachments (initially possibly empty, always an array)', async () => {
    const { status, data } = await api(`/work-items/${workItemId}/attachments`)
    assert.equal(status, 200)
    assert.ok(Array.isArray(data.attachments))
  })

  it('creates a link attachment, lists it, deletes it', async () => {
    const { status, data } = await api(`/work-items/${workItemId}/attachments`, {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/spec.pdf', title: 'Spec' }),
    })
    assert.equal(status, 201)
    const att = data.attachment
    assert.equal(att.kind, 'link')
    assert.equal(att.url, 'https://example.com/spec.pdf')
    assert.equal(att.url_title, 'Spec')

    // List should include it
    const { status: listStatus, data: listData } = await api(`/work-items/${workItemId}/attachments`)
    assert.equal(listStatus, 200)
    assert.ok(listData.attachments.some(a => a.id === att.id), 'list should include the new link')

    // Delete
    const { status: delStatus, data: delData } = await api(
      `/work-items/${workItemId}/attachments/${att.id}`,
      { method: 'DELETE' }
    )
    assert.equal(delStatus, 200)
    assert.equal(delData.deleted, true)
    assert.equal(delData.id, att.id)
  })

  it('rejects link without url with 400', async () => {
    const { status } = await api(`/work-items/${workItemId}/attachments`, {
      method: 'POST',
      body: JSON.stringify({ title: 'no url' }),
    })
    assert.equal(status, 400)
  })

  it('rejects a non-http url with 400', async () => {
    const { status } = await api(`/work-items/${workItemId}/attachments`, {
      method: 'POST',
      body: JSON.stringify({ url: 'ftp://example.com/x' }),
    })
    assert.equal(status, 400)
  })
})

// Close the shared PG pool so this test process can exit cleanly (DEBT.26643).
after(closePool)
