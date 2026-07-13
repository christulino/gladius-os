import { describe, it, before, after } from 'node:test'
import { closePool } from './helpers/poolTeardown.js'
import assert from 'node:assert/strict'
import { createAuthApi } from './helpers/auth.js'
import { deleteWorkItems } from './helpers/cleanup.js'
import { createTestOrg } from './helpers/testOrg.js'

const BASE = process.env.API_URL || 'http://localhost:3000'
const BEARER = process.env.GLADIUS_API_KEY || ''

const api = createAuthApi()

// Skip Bearer-specific tests when no API key is configured
const skipBearer = !BEARER

async function bearerFetch(path, options = {}) {
  const res = await fetch(`${BASE}/admin/api${path}`, {
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${BEARER}`, ...options.headers },
    ...options,
  })
  return { status: res.status, data: await res.json() }
}

describe('MCP Field Writes + Exit Criteria', () => {
  let workItemId
  let testOrg

  before(async () => {
    testOrg = await createTestOrg()
    const { status, data } = await api('/work-items', {
      method: 'POST',
      body: JSON.stringify({ title: 'Field writes test ' + Date.now(), work_item_type_id: testOrg.typeId, owner_org_id: testOrg.orgId }),
    })
    assert.equal(status, 201, `create work item failed: ${JSON.stringify(data)}`)
    workItemId = data.id
  })

  after(async () => {
    await deleteWorkItems([workItemId])
    await testOrg.teardown()
  })

  describe('GET /work-items/:id/exit-criteria', () => {
    it('returns array (empty if no exit criteria on current stage)', async () => {
      const { status, data } = await api(`/work-items/${workItemId}/exit-criteria`)
      assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(data)}`)
      assert.ok(Array.isArray(data), `expected array, got ${typeof data}`)
    })

    it('each criterion has required fields', async () => {
      // Find any work item currently in-progress
      const { data: searchData } = await api('/search?stage_class=in-progress&org_id=' + testOrg.orgId + '&limit=5')
      const inProgress = searchData?.rows ?? []
      if (!inProgress.length) return // skip if none in progress

      const testId = inProgress[0].id
      const { status, data } = await api(`/work-items/${testId}/exit-criteria`)
      assert.equal(status, 200)
      if (data.length > 0) {
        const c = data[0]
        assert.ok('id' in c, 'missing id')
        assert.ok('name' in c, 'missing name')
        assert.ok('criteria_tier' in c, 'missing criteria_tier')
        assert.ok('status' in c, 'missing status')
        assert.ok('is_blocking' in c, 'missing is_blocking')
      }
    })

    it('returns 404 for unknown work item', async () => {
      const { status } = await api('/work-items/999999999/exit-criteria')
      assert.equal(status, 404)
    })
  })

  describe('set_work_item_fields via PATCH /work-items/:id', () => {
    it('updates priority via Bearer auth', async () => {
      if (skipBearer) return
      const { status, data } = await bearerFetch(`/work-items/${workItemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ priority: 2 }),
      })
      assert.equal(status, 200, `PATCH failed: ${JSON.stringify(data)}`)
      assert.equal(data.priority, 2)
    })

    it('updates field_values via Bearer auth', async () => {
      if (skipBearer) return
      const { status, data } = await bearerFetch(`/work-items/${workItemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ field_values: { pr_url: 'https://github.com/test/pr/1', pr_status: 'open' } }),
      })
      assert.equal(status, 200)
      assert.equal(data.field_values?.pr_url, 'https://github.com/test/pr/1')
    })
  })
})

// Close the shared PG pool so this test process can exit cleanly (DEBT.26643).
after(closePool)
