import { describe, it, before, after } from 'node:test'
import { closePool } from './helpers/poolTeardown.js'
import assert from 'node:assert/strict'
import { createAuthApi } from './helpers/auth.js'
import { deleteWorkItems } from './helpers/cleanup.js'
import { createTestOrg } from './helpers/testOrg.js'

const BASE = process.env.API_URL || 'http://localhost:3000'
const BEARER = process.env.GLADIUS_API_KEY || ''

const api = createAuthApi()
const skipBearer = !BEARER

async function bearerFetch(path, options = {}) {
  const url = `${BASE}/admin/api${path}`
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${BEARER}`, ...options.headers },
    ...options,
  })
  return { status: res.status, body: await res.json() }
}

describe('Work-item link/unlink API', () => {
  let itemA, itemB
  let testOrg

  before(async () => {
    testOrg = await createTestOrg()
    const stamp = Date.now()
    const [resA, resB] = await Promise.all([
      api('/work-items', {
        method: 'POST',
        body: JSON.stringify({ title: `Link test A ${stamp}`, work_item_type_id: testOrg.typeId, owner_org_id: testOrg.orgId }),
      }),
      api('/work-items', {
        method: 'POST',
        body: JSON.stringify({ title: `Link test B ${stamp}`, work_item_type_id: testOrg.typeId, owner_org_id: testOrg.orgId }),
      }),
    ])
    assert.equal(resA.status, 201, `create A failed: ${JSON.stringify(resA.data)}`)
    assert.equal(resB.status, 201, `create B failed: ${JSON.stringify(resB.data)}`)
    itemA = resA.data.id
    itemB = resB.data.id
  })

  after(async () => {
    await deleteWorkItems([itemA, itemB])
    await testOrg.teardown()
  })

  describe('POST /work-items/:id/links', () => {
    it('creates a related link via session auth', async () => {
      const { status, data } = await api(`/work-items/${itemA}/links`, {
        method: 'POST',
        body: JSON.stringify({ target_work_item_id: itemB, link_type: 'related' }),
      })
      assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(data)}`)
      assert.equal(data.link_type, 'related')
      assert.equal(data.source_work_item_id, itemA)
      assert.equal(data.target_work_item_id, itemB)
    })

    it('returns 409 on duplicate link', async () => {
      const { status } = await api(`/work-items/${itemA}/links`, {
        method: 'POST',
        body: JSON.stringify({ target_work_item_id: itemB, link_type: 'related' }),
      })
      assert.equal(status, 409)
    })

    it('creates a blocks link via Bearer auth', async () => {
      if (skipBearer) return
      const { status, body } = await bearerFetch(`/work-items/${itemA}/links`, {
        method: 'POST',
        body: JSON.stringify({ target_work_item_id: itemB, link_type: 'blocks' }),
      })
      assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`)
      assert.equal(body.link_type, 'blocks')
    })

    it('returns 400 when link_type is missing', async () => {
      const { status } = await api(`/work-items/${itemA}/links`, {
        method: 'POST',
        body: JSON.stringify({ target_work_item_id: itemB }),
      })
      assert.equal(status, 400)
    })
  })

  describe('GET /work-items/:id/links', () => {
    it('returns created links', async () => {
      const { status, data } = await api(`/work-items/${itemA}/links`)
      assert.equal(status, 200)
      assert.ok(Array.isArray(data.rows), 'expected rows array')
      const types = data.rows.map(r => r.link_type)
      assert.ok(types.includes('related'), `expected related in ${JSON.stringify(types)}`)
    })

    it('bidirectional — target also sees the link', async () => {
      const { status, data } = await api(`/work-items/${itemB}/links`)
      assert.equal(status, 200)
      assert.ok(data.rows.some(r => r.id === itemA), 'expected itemA in itemB links')
    })
  })

  describe('DELETE /work-items/:id/links/:targetId', () => {
    it('returns 400 when link_type query param is missing', async () => {
      const { status } = await api(`/work-items/${itemA}/links/${itemB}`, { method: 'DELETE' })
      assert.equal(status, 400)
    })

    it('removes the related link via session auth', async () => {
      const { status, data } = await api(`/work-items/${itemA}/links/${itemB}?link_type=related`, {
        method: 'DELETE',
      })
      assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(data)}`)
      assert.equal(data.deleted, true)
      assert.equal(data.link_type, 'related')
    })

    it('returns 404 after deletion (link gone)', async () => {
      const { status } = await api(`/work-items/${itemA}/links/${itemB}?link_type=related`, {
        method: 'DELETE',
      })
      assert.equal(status, 404)
    })

    it('removes the blocks link via Bearer auth', async () => {
      if (skipBearer) return
      const { status, body } = await bearerFetch(
        `/work-items/${itemA}/links/${itemB}?link_type=blocks`,
        { method: 'DELETE' }
      )
      assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`)
      assert.equal(body.deleted, true)
    })

    it('returns 404 for unknown work item', async () => {
      const { status } = await api(`/work-items/999999999/links/${itemB}?link_type=related`, {
        method: 'DELETE',
      })
      assert.equal(status, 404)
    })
  })
})

// Close the shared PG pool so this test process can exit cleanly (DEBT.26643).
after(closePool)
