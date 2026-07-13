import { describe, it, before, after } from 'node:test'
import { closePool } from './helpers/poolTeardown.js'
import assert from 'node:assert/strict'
import { query } from '../db/postgres.js'
import { createAuthApi } from './helpers/auth.js'
import { createTestOrg } from './helpers/testOrg.js'
import { createTestStage } from './helpers/testStage.js'

const BASE = process.env.API_URL || 'http://localhost:3000'
const BEARER = process.env.GLADIUS_API_KEY || ''

const api = createAuthApi()

async function bearerFetch(path, options = {}) {
  const res = await fetch(`${BASE}/admin/api${path}`, {
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${BEARER}`, ...options.headers },
    ...options,
  })
  return { status: res.status, data: await res.json() }
}

describe('MCP Playbook Read', () => {
  let testOrg
  let workItemInBacklog
  let playbookStageItemId
  let playbookStageId

  before(async () => {
    testOrg = await createTestOrg()

    // Create a test work item (lands in the entry stage, which has no playbook)
    const { status, data } = await api('/work-items', {
      method: 'POST',
      body: JSON.stringify({ title: 'Playbook read test ' + Date.now(), work_item_type_id: testOrg.typeId, owner_org_id: testOrg.orgId }),
    })
    assert.equal(status, 201, `create work item failed: ${JSON.stringify(data)}`)
    workItemInBacklog = data.id

    // Dedicated throwaway stage with an active playbook, owned by the test org —
    // isolates the positive case from dogfood's real Discovery-stage playbook,
    // which would otherwise require reading the live board to find a matching item.
    ;({ stageId: playbookStageId } = await createTestStage(testOrg.orgId, { stageClass: 'in-progress' }))
    await query(`
      INSERT INTO blueprint.stage_playbooks (stage_id, name, content, is_active, execution_owner)
      VALUES ($1, $2, $3, true, 'in_server')
    `, [playbookStageId, '__test playbook-read stage ' + Date.now(),
        '---\nmodel: sonnet\ntrigger: on_enter\n---\nTest playbook body.'])

    const { status: s2, data: item2 } = await api('/work-items', {
      method: 'POST',
      body: JSON.stringify({ title: 'Playbook read test (active) ' + Date.now(), work_item_type_id: testOrg.typeId, owner_org_id: testOrg.orgId }),
    })
    assert.equal(s2, 201, `create work item failed: ${JSON.stringify(item2)}`)
    playbookStageItemId = item2.id

    // Point the item at the throwaway stage directly — it isn't reachable via a
    // normal transition since it doesn't belong to the item's own workflow.
    await query('UPDATE runtime.work_items SET current_stage_id = $1 WHERE id = $2', [playbookStageId, playbookStageItemId])
  })

  after(async () => {
    await testOrg.teardown()
  })

  it('returns 404 when no active playbook for current stage', async () => {
    // New items start in the entry stage, which has no playbook
    const { status } = await api(`/work-items/${workItemInBacklog}/stage-playbook`)
    assert.equal(status, 404, `expected 404 for entry stage (no playbook)`)
  })

  it('returns 404 for unknown work item', async () => {
    const { status } = await api('/work-items/999999999/stage-playbook')
    assert.equal(status, 404)
  })

  it('returns 200 with playbook content when active playbook exists', async () => {
    const { status, data } = await api(`/work-items/${playbookStageItemId}/stage-playbook`)
    assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(data)}`)
    assert.ok(data.id, 'missing id')
    assert.ok(data.content, 'missing content')
    assert.ok(typeof data.is_active === 'boolean', 'missing is_active')
  })

  it('returns playbook via Bearer auth', async () => {
    const { status } = await bearerFetch(`/work-items/${workItemInBacklog}/stage-playbook`)
    // 404 is correct (entry stage has no playbook), but NOT 401
    assert.notEqual(status, 401, 'Bearer auth should work')
  })
})

// Close the shared PG pool so this test process can exit cleanly (DEBT.26643).
after(closePool)
