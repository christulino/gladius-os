import { describe, it, before, after } from 'node:test'
import { closePool } from './helpers/poolTeardown.js'
import assert from 'node:assert/strict'
import { createAuthApi } from './helpers/auth.js'
import { createTestOrg } from './helpers/testOrg.js'
import { createTestStage } from './helpers/testStage.js'

const api = createAuthApi()

describe('Two-Writers Guard', () => {
  describe('execution_owner in playbook API', () => {
    let testOrg
    let stageId
    let playbookId

    before(async () => {
      testOrg = await createTestOrg()
      ;({ stageId } = await createTestStage(testOrg.orgId, { stageClass: 'intake' }))

      const { status, data } = await api(`/stages/${stageId}/playbook`, {
        method: 'POST',
        body: JSON.stringify({ name: 'Two-Writers Test Playbook', content: 'Test playbook content.' }),
      })
      assert.equal(status, 201, `create playbook failed: ${JSON.stringify(data)}`)
      playbookId = data.id
    })

    after(async () => {
      // testOrg.teardown() deletes stages/workflows owned by the ephemeral
      // org; stage_playbooks CASCADE off stage deletion, so playbookId
      // needs no separate cleanup.
      if (testOrg) await testOrg.teardown()
    })

    it('GET /stages/:id/playbook returns execution_owner field', async () => {
      const { status, data } = await api(`/stages/${stageId}/playbook`)
      assert.equal(status, 200)
      const pb = data?.rows?.[0] ?? data
      assert.ok('execution_owner' in pb, `missing execution_owner field; got keys: ${Object.keys(pb).join(', ')}`)
      assert.ok(
        pb.execution_owner === 'in_server' || pb.execution_owner === 'agent',
        `unexpected execution_owner value: ${pb.execution_owner}`,
      )
    })

    it('PATCH /organizations/:orgId/playbooks/:id accepts execution_owner', async () => {
      // Set to 'agent'
      const { status: s1, data: d1 } = await api(`/organizations/${testOrg.orgId}/playbooks/${playbookId}`, {
        method: 'PATCH',
        body: JSON.stringify({ execution_owner: 'agent' }),
      })
      assert.equal(s1, 200, `PATCH failed: ${JSON.stringify(d1)}`)
      assert.equal(d1.execution_owner, 'agent')

      // Restore to 'in_server'
      const { status: s2, data: d2 } = await api(`/organizations/${testOrg.orgId}/playbooks/${playbookId}`, {
        method: 'PATCH',
        body: JSON.stringify({ execution_owner: 'in_server' }),
      })
      assert.equal(s2, 200)
      assert.equal(d2.execution_owner, 'in_server')
    })

    it('PATCH rejects invalid execution_owner value', async () => {
      const { status } = await api(`/organizations/${testOrg.orgId}/playbooks/${playbookId}`, {
        method: 'PATCH',
        body: JSON.stringify({ execution_owner: 'invalid_value' }),
      })
      assert.equal(status, 400, 'should reject invalid execution_owner')
    })
  })
})

// Close the shared PG pool so this test process can exit cleanly (DEBT.26643).
after(closePool)
