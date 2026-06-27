import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createAuthApi, getSessionCookie } from './helpers/auth.js'
import { deleteWorkItems } from './helpers/cleanup.js'

const BASE = process.env.API_URL || 'http://localhost:3000'
const api = createAuthApi()

async function createWorkItem() {
  const { data: orgs } = await api('/organizations')
  const { data: types } = await api('/work-item-types')
  assert.ok(orgs.rows?.length, 'Need at least one org')
  assert.ok(types.rows?.length, 'Need at least one work item type')
  const { data: wi } = await api('/work-items', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Attachment Test Item ' + Date.now(),
      work_item_type_id: types.rows[0].id,
      owner_org_id: orgs.rows[0].id,
    }),
  })
  assert.ok(wi.id, 'Should create work item for attachments test')
  return wi.id
}

describe('Attachments API', () => {
  let workItemId

  before(async () => {
    workItemId = await createWorkItem()
  })

  after(async () => {
    await deleteWorkItems([workItemId])
  })

  it('lists attachments (initially possibly empty, always an array)', async () => {
    const { status, data } = await api(`/work-items/${workItemId}/attachments`)
    assert.equal(status, 200)
    assert.ok(Array.isArray(data.attachments))
  })

  it('uploads a file, lists it, downloads it, deletes it', async () => {
    const cookie = await getSessionCookie()

    const fd = new FormData()
    fd.set(
      'file',
      new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'application/octet-stream' }),
      'hello.bin'
    )

    const up = await fetch(`${BASE}/admin/api/work-items/${workItemId}/attachments`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: fd,
    })
    const upBody = await up.json()
    assert.equal(up.status, 201, JSON.stringify(upBody))
    const att = upBody.attachment
    assert.equal(att.kind, 'file')
    assert.equal(att.file_name, 'hello.bin')
    assert.equal(Number(att.file_size_bytes), 4)
    assert.equal(att.work_item_id, workItemId)

    // List
    const { status: listStatus, data: listData } = await api(`/work-items/${workItemId}/attachments`)
    assert.equal(listStatus, 200)
    assert.ok(listData.attachments.some(a => a.id === att.id), 'list should include the new attachment')

    // Download
    const dl = await fetch(`${BASE}/admin/api/work-items/${workItemId}/attachments/${att.id}/download`, {
      headers: { Cookie: cookie },
    })
    assert.equal(dl.status, 200)
    assert.equal(dl.headers.get('content-type'), 'application/octet-stream')
    const buf = Buffer.from(await dl.arrayBuffer())
    assert.deepEqual([...buf], [1, 2, 3, 4])

    // Delete
    const { status: delStatus, data: delData } = await api(
      `/work-items/${workItemId}/attachments/${att.id}`,
      { method: 'DELETE' }
    )
    assert.equal(delStatus, 200)
    assert.equal(delData.deleted, true)
    assert.equal(delData.id, att.id)
  })

  it('creates a link attachment', async () => {
    const { status, data } = await api(`/work-items/${workItemId}/attachments`, {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/spec.pdf', title: 'Spec' }),
    })
    assert.equal(status, 201)
    const att = data.attachment
    assert.equal(att.kind, 'link')
    assert.equal(att.url, 'https://example.com/spec.pdf')
    assert.equal(att.url_title, 'Spec')

    // cleanup
    await api(`/work-items/${workItemId}/attachments/${att.id}`, { method: 'DELETE' })
  })

  it('rejects link without url with 400', async () => {
    const { status } = await api(`/work-items/${workItemId}/attachments`, {
      method: 'POST',
      body: JSON.stringify({ title: 'no url' }),
    })
    assert.equal(status, 400)
  })

  it('rejects file over the size limit with 413', async () => {
    const cookie = await getSessionCookie()
    const big = new Uint8Array(26 * 1024 * 1024) // 26 MB > default 25 MB
    const fd = new FormData()
    fd.set('file', new Blob([big], { type: 'application/octet-stream' }), 'big.bin')

    const r = await fetch(`${BASE}/admin/api/work-items/${workItemId}/attachments`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: fd,
    })
    assert.equal(r.status, 413)
  })

  it('returns 404 for download of non-existent attachment', async () => {
    const cookie = await getSessionCookie()
    const r = await fetch(`${BASE}/admin/api/work-items/${workItemId}/attachments/99999999/download`, {
      headers: { Cookie: cookie },
    })
    assert.equal(r.status, 404)
  })

  it('returns 404 for download when attachment exists but on different work item', async () => {
    // Create on this work item, then try downloading via a different (non-existent) work item id.
    const { data } = await api(`/work-items/${workItemId}/attachments`, {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/x' }),
    })
    const att = data.attachment
    // Query the download with a wrong work-item id
    const cookie = await getSessionCookie()
    const r = await fetch(`${BASE}/admin/api/work-items/9999999/attachments/${att.id}/download`, {
      headers: { Cookie: cookie },
    })
    assert.equal(r.status, 404)

    // cleanup
    await api(`/work-items/${workItemId}/attachments/${att.id}`, { method: 'DELETE' })
  })
})
