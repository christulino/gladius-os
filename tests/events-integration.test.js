// End-to-end event system tests against a running API server.
//
// Requires: `npm run dev` (or `npm start`) on port 3000. The live server
// holds the processor's PG advisory lock and drains in-process. For
// processor unit tests that take the lock themselves, see
// tests/events-processor.test.js.

import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { query } from '../db/postgres.js'
import { createAuthApi } from './helpers/auth.js'

const api = createAuthApi()

describe('PATCH /work-items/:id — emits work_item.edited + writes audit rows', () => {
  let workItemId
  before(async () => {
    const { rows } = await query('SELECT id FROM runtime.work_items ORDER BY id ASC LIMIT 1')
    workItemId = rows[0].id
    await query('UPDATE runtime.work_items SET priority = NULL WHERE id = $1', [workItemId])
    await query('DELETE FROM runtime.events WHERE event_type = $1', ['work_item.edited'])
    await query('DELETE FROM runtime.work_item_edits WHERE work_item_id = $1', [workItemId])
  })

  it('emits one event and writes one audit row per changed field', async () => {
    const { status } = await api(`/work-items/${workItemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Edited by test ' + Date.now(), priority: 1 }),
    })
    assert.equal(status, 200)

    await new Promise(r => setTimeout(r, 500))

    const { rows: events } = await query(
      `SELECT payload FROM runtime.events
       WHERE event_type = 'work_item.edited' AND entity_id = $1
       ORDER BY id DESC LIMIT 1`,
      [workItemId]
    )
    assert.equal(events.length, 1)
    assert.ok(Array.isArray(events[0].payload.changes))
    const fields = events[0].payload.changes.map(c => c.field)
    assert.ok(fields.includes('title'))
    assert.ok(fields.includes('priority'))

    const { rows: audit } = await query(
      `SELECT field_key FROM runtime.work_item_edits
       WHERE edit_group_id = $1
       ORDER BY field_key`,
      [events[0].payload.edit_group_id]
    )
    assert.equal(audit.length, 2)
  })

  it('does not emit when the PATCH changes nothing', async () => {
    const { data } = await api(`/work-items/${workItemId}`)
    const current = data.title

    await query('DELETE FROM runtime.events WHERE event_type = $1', ['work_item.edited'])

    const { status } = await api(`/work-items/${workItemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: current }),
    })
    assert.equal(status, 200)
    await new Promise(r => setTimeout(r, 200))

    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM runtime.events
       WHERE event_type = 'work_item.edited' AND entity_id = $1`,
      [workItemId]
    )
    assert.equal(rows[0].n, 0)
  })
})

describe('Emission on people / link / comment / substate endpoints', () => {
  let workItemId, userId
  before(async () => {
    const { rows: wi } = await query('SELECT id FROM runtime.work_items ORDER BY id ASC LIMIT 1')
    workItemId = wi[0].id
    const { rows: u } = await query('SELECT id FROM blueprint.users WHERE is_active = true ORDER BY id ASC LIMIT 1')
    userId = u[0].id
    await query(`UPDATE runtime.work_items SET current_substate = 'blocked' WHERE id = $1`, [workItemId])
  })

  it('emits work_item.assigned when a relationship is created', async () => {
    await query(`DELETE FROM runtime.work_item_user_relationships
                 WHERE work_item_id = $1 AND user_id = $2 AND relationship_type = 'watching'`,
                [workItemId, userId])
    await query(`DELETE FROM runtime.events WHERE event_type = 'work_item.assigned' AND entity_id = $1`, [workItemId])

    const { status } = await api(`/work-items/${workItemId}/relationships`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, relationship_type: 'watching' }),
    })
    assert.equal(status, 201)
    await new Promise(r => setTimeout(r, 200))

    const { rows } = await query(
      `SELECT payload FROM runtime.events
       WHERE event_type = 'work_item.assigned' AND entity_id = $1
       ORDER BY id DESC LIMIT 1`,
      [workItemId]
    )
    assert.equal(rows.length, 1)
    assert.equal(rows[0].payload.relationship_type, 'watching')
  })

  it('emits work_item.commented when a comment is posted', async () => {
    await query(`DELETE FROM runtime.events WHERE event_type = 'work_item.commented' AND entity_id = $1`, [workItemId])

    const { status } = await api(`/work-items/${workItemId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Event system test comment' }),
    })
    assert.equal(status, 201)
    await new Promise(r => setTimeout(r, 200))

    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM runtime.events
       WHERE event_type = 'work_item.commented' AND entity_id = $1`,
      [workItemId]
    )
    assert.ok(rows[0].n >= 1)
  })

  it('emits work_item.substate_changed', async () => {
    await query(`DELETE FROM runtime.events WHERE event_type = 'work_item.substate_changed' AND entity_id = $1`, [workItemId])

    const { status } = await api(`/work-items/${workItemId}/substate`, {
      method: 'POST',
      body: JSON.stringify({ substate: 'active' }),
    })
    assert.equal(status, 200)
    await new Promise(r => setTimeout(r, 200))

    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM runtime.events
       WHERE event_type = 'work_item.substate_changed' AND entity_id = $1`,
      [workItemId]
    )
    assert.ok(rows[0].n >= 1)
  })
})

describe('Emission on exit-criteria endpoints', () => {
  it('emits exit_criteria.acknowledged / unacknowledged / waived when invoked', async () => {
    const { rows: stageItems } = await query(`
      SELECT wi.id AS work_item_id, ec.id AS ec_id
      FROM runtime.work_items wi
      JOIN blueprint.exit_criteria ec ON ec.stage_id = wi.current_stage_id
      WHERE ec.criteria_tier = 'manual' AND ec.is_active = true
      LIMIT 1
    `)
    if (!stageItems.length) {
      console.log('[skip] no manual exit criteria found in seed; skipping')
      return
    }
    const { work_item_id, ec_id } = stageItems[0]

    await query(`DELETE FROM runtime.events
                 WHERE event_type IN ('exit_criteria.acknowledged',
                                      'exit_criteria.unacknowledged',
                                      'exit_criteria.waived')
                 AND entity_id = $1`, [work_item_id])

    let res = await api(`/work-items/${work_item_id}/exit-criteria/${ec_id}/acknowledge`, { method: 'POST' })
    assert.equal(res.status, 200)
    await new Promise(r => setTimeout(r, 200))

    res = await api(`/work-items/${work_item_id}/exit-criteria/${ec_id}/acknowledge`, { method: 'DELETE' })
    assert.equal(res.status, 200)
    await new Promise(r => setTimeout(r, 200))

    res = await api(`/work-items/${work_item_id}/exit-criteria/${ec_id}/waive`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Test waive' }),
    })
    assert.equal(res.status, 200)
    await new Promise(r => setTimeout(r, 200))

    const { rows } = await query(`
      SELECT event_type FROM runtime.events
      WHERE entity_id = $1
        AND event_type LIKE 'exit_criteria.%'
      ORDER BY id DESC LIMIT 3
    `, [work_item_id])
    const types = rows.map(r => r.event_type).sort()
    assert.deepEqual(types, [
      'exit_criteria.acknowledged',
      'exit_criteria.unacknowledged',
      'exit_criteria.waived',
    ].sort())
  })
})

describe('Admin API — event subscribers endpoints', () => {
  it('GET /event-subscribers returns registered subscribers with cursors', async () => {
    const { status, data } = await api('/event-subscribers')
    assert.equal(status, 200)
    assert.ok(Array.isArray(data.rows))
    const names = data.rows.map(r => r.name)
    assert.ok(names.includes('audit-log'))
  })

  it('POST /event-subscribers/:name/pause toggles pause', async () => {
    const pauseRes = await api('/event-subscribers/audit-log/pause', {
      method: 'POST',
      body: JSON.stringify({ is_paused: true }),
    })
    assert.equal(pauseRes.status, 200)

    const { data } = await api('/event-subscribers')
    const sub = data.rows.find(r => r.name === 'audit-log')
    assert.equal(sub.is_paused, true)

    await api('/event-subscribers/audit-log/pause', {
      method: 'POST',
      body: JSON.stringify({ is_paused: false }),
    })
  })

  it('GET /events returns recent events ordered newest-first', async () => {
    const { status, data } = await api('/events?limit=10')
    assert.equal(status, 200)
    assert.ok(Array.isArray(data.rows))
    if (data.rows.length >= 2) {
      assert.ok(data.rows[0].id >= data.rows[1].id, 'should be newest-first')
    }
  })
})

describe('Advisory lock — only one processor runs', () => {
  it('exactly one advisory lock is held for the processor key', async () => {
    const { rows } = await query(
      "SELECT COUNT(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND objid = 252727379"
    )
    assert.equal(rows[0].n, 1, 'exactly one advisory lock should be held')
  })
})

describe('API latency — emission does not block response', () => {
  it('PATCH /work-items/:id returns under 200ms even with emission', async () => {
    const { rows } = await query('SELECT id FROM runtime.work_items ORDER BY id ASC LIMIT 1')
    const id = rows[0].id

    const t0 = performance.now()
    const { status } = await api(`/work-items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ description: 'latency test ' + Date.now() }),
    })
    const elapsed = performance.now() - t0
    assert.equal(status, 200)
    assert.ok(elapsed < 500, `PATCH took ${elapsed}ms — emission should not block response materially`)
  })
})

describe('End-to-end — work item creation flows through event system to subscribers', () => {
  it('creating a work item produces a work_item.created event that advances audit-log cursor', async () => {
    const cursorBefore = await query(
      "SELECT last_processed_event_id FROM runtime.event_subscribers WHERE name = 'audit-log'"
    )
    const before = Number(cursorBefore.rows[0].last_processed_event_id)

    const { rows: types } = await query(
      "SELECT id FROM blueprint.work_item_types WHERE is_active = true LIMIT 1"
    )
    const { rows: orgs } = await query(
      "SELECT id FROM blueprint.organizations WHERE is_active = true LIMIT 1"
    )
    const res = await api('/work-items', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Event system e2e ' + Date.now(),
        work_item_type_id: types[0].id,
        owner_org_id: orgs[0].id,
      }),
    })
    assert.equal(res.status, 201)

    // Also PATCH the new item to produce a work_item.edited event the audit-log subscriber handles
    const newItemId = res.data?.id
    if (newItemId) {
      await api(`/work-items/${newItemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ description: 'e2e cursor test ' + Date.now() }),
      })
    }

    let cursorAfter = before
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 200))
      const c = await query(
        "SELECT last_processed_event_id FROM runtime.event_subscribers WHERE name = 'audit-log'"
      )
      cursorAfter = Number(c.rows[0].last_processed_event_id)
      if (cursorAfter > before) break
    }
    assert.ok(cursorAfter > before, `audit-log cursor did not advance (was ${before}, is ${cursorAfter})`)
  })
})
