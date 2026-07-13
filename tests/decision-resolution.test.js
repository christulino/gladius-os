// tests/decision-resolution.test.js
// FEAT.25360 — open/resolved lifecycle for decision-type context entries.
// Run against a server with migration 019 applied:  API_URL=http://localhost:3001 node --test tests/decision-resolution.test.js
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

describe('Decision resolution API (FEAT.25360)', () => {
  let workItemId, decisionId, discoveryId

  before(async () => {
    const { data: wi } = await api('/work-items', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Decision Resolution Test ' + Date.now(),
        work_item_type_id: testOrg.typeId,
        owner_org_id: testOrg.orgId,
      }),
    })
    workItemId = wi.id
    assert.ok(workItemId, 'need a work item')

    const { data: dec } = await api(`/work-items/${workItemId}/context-entries`, {
      method: 'POST',
      body: JSON.stringify({ type: 'decision', title: 'Pick a store', content: '## Question\nColumns or table?' }),
    })
    decisionId = dec.id
    const { data: disc } = await api(`/work-items/${workItemId}/context-entries`, {
      method: 'POST',
      body: JSON.stringify({ type: 'discovery', content: 'not a decision' }),
    })
    discoveryId = disc.id
  })

  it('a new decision entry defaults to open (resolved=false)', async () => {
    const { data } = await api(`/work-items/${workItemId}/context-entries`)
    const dec = data.rows.find(r => r.id === decisionId)
    assert.equal(dec.resolved, false)
    assert.equal(dec.resolved_by, null)
    assert.equal(dec.resolved_at, null)
  })

  it('resolves a decision with answer + attribution + timestamp', async () => {
    const { status, data } = await api(`/work-items/${workItemId}/context-entries/${decisionId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution_text: 'Columns + event-log history.' }),
    })
    assert.equal(status, 200)
    assert.equal(data.resolved, true)
    assert.equal(data.resolution_text, 'Columns + event-log history.')
    assert.ok(data.resolved_by, 'records resolver identity')
    assert.ok(data.resolved_at, 'records timestamp')
  })

  it('refuses to resolve a non-decision entry (404)', async () => {
    const { status } = await api(`/work-items/${workItemId}/context-entries/${discoveryId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution_text: 'should fail' }),
    })
    assert.equal(status, 404)
  })

  it('reopens a resolved decision, clearing the resolution columns', async () => {
    const { status, data } = await api(`/work-items/${workItemId}/context-entries/${decisionId}/reopen`, {
      method: 'POST',
    })
    assert.equal(status, 200)
    assert.equal(data.resolved, false)
    assert.equal(data.resolved_by, null)
    assert.equal(data.resolved_at, null)
    assert.equal(data.resolution_text, null)
  })

  it('refuses to reopen an already-open decision (404)', async () => {
    const { status } = await api(`/work-items/${workItemId}/context-entries/${decisionId}/reopen`, {
      method: 'POST',
    })
    assert.equal(status, 404)
  })

  it('404s resolving a nonexistent entry', async () => {
    const { status } = await api(`/work-items/${workItemId}/context-entries/99999999/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution_text: 'x' }),
    })
    assert.equal(status, 404)
  })
})

// Close the shared PG pool so this test process can exit cleanly (DEBT.26643).
after(closePool)
