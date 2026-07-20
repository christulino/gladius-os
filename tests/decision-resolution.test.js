// tests/decision-resolution.test.js
// FEAT.25360 — open/resolved lifecycle for decision-type context entries.
// Run against a server with migration 019 applied:  API_URL=http://localhost:3001 node --test tests/decision-resolution.test.js
import { describe, it, before, after } from 'node:test'
import { closePool } from './helpers/poolTeardown.js'
import assert from 'node:assert/strict'
import { createAuthApi } from './helpers/auth.js'
import { createTestOrg } from './helpers/testOrg.js'
import { TOOLS } from '../mcp/toolsManifest.js'

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

  // ── Audit-trail rendering ───────────────────────────────────────────────────
  // runtime/workItemHistory.js previously had no handling for the
  // context_entry.decision_* events — they were excluded from the query
  // entirely, so resolve/reopen was invisible in the Activity tab.

  it('renders decision_resolved / decision_reopened in the audit trail', async () => {
    // The decision above has been resolved once and reopened once.
    const { status, data } = await api(`/work-items/${workItemId}/history`)
    assert.equal(status, 200)

    const resolved = data.rows.find(r => r.event_type === 'context_entry.decision_resolved')
    assert.ok(resolved, 'decision_resolved event should appear in history')
    assert.match(resolved.summary, /^resolved decision /)
    assert.match(resolved.summary, /Pick a store/, 'summary names the decision by title')
    assert.match(resolved.summary, /Columns \+ event-log history\./, 'summary carries the answer')
    assert.equal(resolved.details.preview, 'Columns + event-log history.')

    const reopened = data.rows.find(r => r.event_type === 'context_entry.decision_reopened')
    assert.ok(reopened, 'decision_reopened event should appear in history')
    assert.match(reopened.summary, /^reopened decision /)
    assert.match(reopened.summary, /Pick a store/)
    assert.equal(reopened.details, null)
  })

  it('falls back to the entry id when a resolved decision has no title', async () => {
    const { data: untitled } = await api(`/work-items/${workItemId}/context-entries`, {
      method: 'POST',
      body: JSON.stringify({ type: 'decision', content: 'No title on this one.' }),
    })
    await api(`/work-items/${workItemId}/context-entries/${untitled.id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution_text: 'answered' }),
    })
    const { data } = await api(`/work-items/${workItemId}/history`)
    const row = data.rows.find(
      r => r.event_type === 'context_entry.decision_resolved' && r.summary.includes(`#${untitled.id}`),
    )
    assert.ok(row, `expected a summary referencing #${untitled.id}`)
    assert.equal(row.summary, `resolved decision #${untitled.id}: answered`)
  })
})

// ── MCP tool surface (journal entry 1008) ─────────────────────────────────────
// Decision resolution was reachable only via raw REST; agents had no sanctioned
// tool. These assert the manifest contract shared with GET /admin/api/mcp/tools.
// (The dispatch cases themselves live in the stdio server, which self-starts on
// import and so is exercised by a real MCP client, not by this process.)

describe('MCP resolve_decision / reopen_decision tools', () => {
  it('exposes resolve_decision with the cross-tenant guard in required params', () => {
    const tool = TOOLS.find(t => t.name === 'resolve_decision')
    assert.ok(tool, 'resolve_decision must exist in the manifest')
    assert.deepEqual(
      [...tool.inputSchema.required].sort(),
      ['entry_id', 'org_id', 'resolution_text', 'work_item_id'],
    )
    assert.equal(tool.inputSchema.properties.entry_id.type, 'number')
    assert.equal(tool.inputSchema.properties.resolution_text.type, 'string')
  })

  it('exposes reopen_decision with the cross-tenant guard in required params', () => {
    const tool = TOOLS.find(t => t.name === 'reopen_decision')
    assert.ok(tool, 'reopen_decision must exist in the manifest')
    assert.deepEqual(
      [...tool.inputSchema.required].sort(),
      ['entry_id', 'org_id', 'work_item_id'],
    )
    assert.ok(!tool.inputSchema.properties.resolution_text, 'reopen takes no resolution text')
  })

  it('is served by the REST tool manifest endpoint', async () => {
    const { status, data } = await api('/mcp/tools')
    assert.equal(status, 200)
    const names = data.tools.map(t => t.name)
    assert.ok(names.includes('resolve_decision'), 'resolve_decision missing from /mcp/tools')
    assert.ok(names.includes('reopen_decision'), 'reopen_decision missing from /mcp/tools')
  })
})

// Close the shared PG pool so this test process can exit cleanly (DEBT.26643).
after(closePool)
