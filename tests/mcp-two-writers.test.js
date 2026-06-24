import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createAuthApi } from './helpers/auth.js'

const ORG_ID = 109

const api = createAuthApi()

describe('Two-Writers Guard', () => {
  describe('execution_owner in playbook API', () => {
    it('GET /stages/:id/playbook returns execution_owner field', async () => {
      // Stage 638 = Discovery — has an active playbook in dogfood
      const { status, data } = await api('/stages/638/playbook')
      if (status === 404) {
        console.log('  (skipping: no playbook on stage 638)')
        return
      }
      assert.equal(status, 200)
      const pb = data?.rows?.[0] ?? data
      assert.ok('execution_owner' in pb, `missing execution_owner field; got keys: ${Object.keys(pb).join(', ')}`)
      assert.ok(
        pb.execution_owner === 'in_server' || pb.execution_owner === 'agent',
        `unexpected execution_owner value: ${pb.execution_owner}`,
      )
    })

    it('PATCH /organizations/:orgId/playbooks/:id accepts execution_owner', async () => {
      // Find a playbook to test with
      const { data: stageData } = await api('/stages/638/playbook')
      const pb = stageData?.rows?.[0] ?? stageData
      if (!pb?.id) {
        console.log('  (skipping: no playbook on stage 638)')
        return
      }
      const playbookId = pb.id

      // Set to 'agent'
      const { status: s1, data: d1 } = await api(`/organizations/${ORG_ID}/playbooks/${playbookId}`, {
        method: 'PATCH',
        body: JSON.stringify({ execution_owner: 'agent' }),
      })
      assert.equal(s1, 200, `PATCH failed: ${JSON.stringify(d1)}`)
      assert.equal(d1.execution_owner, 'agent')

      // Restore to 'in_server'
      const { status: s2, data: d2 } = await api(`/organizations/${ORG_ID}/playbooks/${playbookId}`, {
        method: 'PATCH',
        body: JSON.stringify({ execution_owner: 'in_server' }),
      })
      assert.equal(s2, 200)
      assert.equal(d2.execution_owner, 'in_server')
    })

    it('PATCH rejects invalid execution_owner value', async () => {
      const { data: stageData } = await api('/stages/638/playbook')
      const pb = stageData?.rows?.[0] ?? stageData
      if (!pb?.id) {
        console.log('  (skipping: no playbook on stage 638)')
        return
      }
      const { status } = await api(`/organizations/${ORG_ID}/playbooks/${pb.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ execution_owner: 'invalid_value' }),
      })
      assert.equal(status, 400, 'should reject invalid execution_owner')
    })
  })
})
