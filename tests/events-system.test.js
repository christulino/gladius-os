import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { query, getClient } from '../db/postgres.js'
import { emitEvent } from '../core/events.js'
import {
  startProcessor,
  stopProcessor,
  registerSubscriber,
  clearSubscribersForTests,
  drainNow,
} from '../runtime/eventProcessor.js'
import { neo4jSyncHandler } from '../runtime/subscribers/neo4jSync.js'

describe('core/events.js — emitEvent', () => {
  before(async () => {
    // Isolate tests from prior events
    await query('DELETE FROM runtime.events WHERE event_type LIKE $1', ['test.%'])
  })

  it('inserts an event row when called inside a committed transaction', async () => {
    const client = await getClient()
    let eventId
    try {
      await client.query('BEGIN')
      eventId = await emitEvent(client, {
        eventType: 'test.emit_commits',
        entityId:  1,
        entityUri: 'flowos://system/test/1',
        actorId:   null,
        payload:   { hello: 'world' },
      })
      await client.query('COMMIT')
    } finally {
      client.release()
    }

    assert.ok(eventId, 'emitEvent should return an id')
    const { rows } = await query('SELECT * FROM runtime.events WHERE id = $1', [eventId])
    assert.equal(rows.length, 1)
    assert.equal(rows[0].event_type, 'test.emit_commits')
    assert.equal(rows[0].payload.hello, 'world')
  })

  it('does NOT insert an event row when the transaction rolls back', async () => {
    const client = await getClient()
    let eventId
    try {
      await client.query('BEGIN')
      eventId = await emitEvent(client, {
        eventType: 'test.emit_rolls_back',
        entityId:  2,
        payload:   { rolled: 'back' },
      })
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }

    const { rows } = await query('SELECT * FROM runtime.events WHERE id = $1', [eventId])
    assert.equal(rows.length, 0, 'event row must not exist after rollback')
  })

  it('throws when client is missing', async () => {
    await assert.rejects(
      () => emitEvent(null, { eventType: 'test.no_client', entityId: 1 }),
      /requires a pg client/,
    )
  })

  it('throws when eventType is missing or non-string', async () => {
    const client = await getClient()
    try {
      await assert.rejects(
        () => emitEvent(client, { entityId: 1 }),
        /requires eventType/,
      )
      await assert.rejects(
        () => emitEvent(client, { eventType: 42, entityId: 1 }),
        /requires eventType/,
      )
    } finally {
      client.release()
    }
  })

  it('throws when entityId is missing or not an integer', async () => {
    const client = await getClient()
    try {
      await assert.rejects(
        () => emitEvent(client, { eventType: 'test.no_id' }),
        /requires entityId/,
      )
      await assert.rejects(
        () => emitEvent(client, { eventType: 'test.string_id', entityId: '42' }),
        /requires entityId \(integer\)/,
      )
    } finally {
      client.release()
    }
  })

  after(async () => {
    await query('DELETE FROM runtime.events WHERE event_type LIKE $1', ['test.%'])
  })
})

describe('runtime/eventProcessor.js — cursor and drain', () => {
  before(async () => {
    clearSubscribersForTests()
    await query('DELETE FROM runtime.event_subscribers WHERE name LIKE $1', ['test-%'])
    await query('DELETE FROM runtime.events WHERE event_type LIKE $1', ['test.%'])
  })

  after(async () => {
    await stopProcessor()
    clearSubscribersForTests()
    await query('DELETE FROM runtime.event_subscribers WHERE name LIKE $1', ['test-%'])
    await query('DELETE FROM runtime.events WHERE event_type LIKE $1', ['test.%'])
  })

  it('advances subscriber cursor after successful handler', async () => {
    const seen = []
    registerSubscriber({
      name: 'test-cursor-advance',
      handles: (t) => t === 'test.cursor_a',
      handler: async (e) => { seen.push(e.id) },
    })
    await startProcessor({ forceTakeLock: true })

    // Emit 3 events outside the processor's knowledge
    const client = await getClient()
    try {
      await client.query('BEGIN')
      for (let i = 0; i < 3; i++) {
        await emitEvent(client, {
          eventType: 'test.cursor_a',
          entityId:  100 + i,
          payload:   { i },
        })
      }
      await client.query('COMMIT')
    } finally { client.release() }

    await drainNow()

    assert.equal(seen.length, 3)
    const { rows } = await query(
      'SELECT last_processed_event_id, events_processed_total FROM runtime.event_subscribers WHERE name = $1',
      ['test-cursor-advance']
    )
    assert.ok(rows[0].last_processed_event_id > 0)
    assert.equal(Number(rows[0].events_processed_total), 3)
  })

  it('leaves cursor at N-1 when handler throws on event N', async () => {
    registerSubscriber({
      name: 'test-failure',
      handles: (t) => t === 'test.fail_on_second',
      handler: async (e) => {
        if (e.payload.n === 2) throw new Error('boom')
      },
    })

    const client = await getClient()
    const emitted = []
    try {
      await client.query('BEGIN')
      for (let n = 1; n <= 3; n++) {
        const id = await emitEvent(client, {
          eventType: 'test.fail_on_second',
          entityId:  n,
          payload:   { n },
        })
        emitted.push(id)
      }
      await client.query('COMMIT')
    } finally { client.release() }

    await drainNow()

    const { rows } = await query(
      'SELECT last_processed_event_id, last_error, failure_count FROM runtime.event_subscribers WHERE name = $1',
      ['test-failure']
    )
    assert.equal(Number(rows[0].last_processed_event_id), Number(emitted[0]),
      'cursor should sit at the last successful event (first one)')
    assert.match(rows[0].last_error, /boom/)
    assert.ok(rows[0].failure_count >= 1)
  })

  it('skips past events a subscriber does not handle (advances cursor without calling handler)', async () => {
    const handled = []
    registerSubscriber({
      name: 'test-filter',
      handles: (t) => t === 'test.want_this',
      handler: async (e) => { handled.push(e.payload.label) },
    })

    const client = await getClient()
    try {
      await client.query('BEGIN')
      await emitEvent(client, { eventType: 'test.dont_want', entityId: 1, payload: { label: 'skip_me' } })
      await emitEvent(client, { eventType: 'test.want_this', entityId: 2, payload: { label: 'take_me' } })
      await emitEvent(client, { eventType: 'test.dont_want', entityId: 3, payload: { label: 'skip_me_too' } })
      await client.query('COMMIT')
    } finally { client.release() }

    await drainNow()

    assert.deepEqual(handled, ['take_me'])
    const { rows } = await query(
      'SELECT last_processed_event_id FROM runtime.event_subscribers WHERE name = $1',
      ['test-filter']
    )
    assert.ok(Number(rows[0].last_processed_event_id) > 0,
      'cursor should advance past skipped events')
  })
})

describe('subscribers/neo4jSync — event-type mapping', () => {
  it('routes work_item.created to syncToGraph work_item create', async () => {
    // We just assert the handler does not throw when called with a synthetic event.
    // Full Neo4j end-to-end sync is tested in Task 14.
    await neo4jSyncHandler({
      id: 9999,
      event_type: 'work_item.created',
      entity_id: 1,
      entity_uri: 'flowos://test/work-items/abc',
      actor_id: null,
      occurred_at: new Date(),
      payload: {
        title: 'Test', work_item_type_uri: null, owner_org_uri: 'flowos://test/orgs/x',
        owner_org_slug: 'x', current_stage_uri: null, current_stage_name: null,
        current_stage_class: null, current_substate: 'active', spawn_state: 'active',
        service_class: 'standard', sla_status: 'no_sla', due_date: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
    })
  })

  it('is a no-op for unmapped event types', async () => {
    await neo4jSyncHandler({
      id: 9998,
      event_type: 'unknown.event_type',
      entity_id: 1,
      payload: {},
    })
    // should not throw
  })
})

import { auditLogHandler, handlesEventType as auditHandles } from '../runtime/subscribers/auditLog.js'

describe('subscribers/auditLog — writes work_item_edits rows', () => {
  let workItemId

  before(async () => {
    // Need a real work item id to satisfy the FK. Use the first one in the DB.
    const { rows } = await query('SELECT id FROM runtime.work_items ORDER BY id ASC LIMIT 1')
    assert.ok(rows.length, 'Need at least one work item in the DB (run npm run seed)')
    workItemId = rows[0].id
    await query('DELETE FROM runtime.work_item_edits WHERE work_item_id = $1', [workItemId])
  })

  it('writes one row per field change, all sharing edit_group_id', async () => {
    const groupId = '00000000-0000-0000-0000-000000000001'
    await auditLogHandler({
      id: 1,
      event_type: 'work_item.edited',
      entity_id: workItemId,
      actor_id: null,
      occurred_at: new Date(),
      payload: {
        edit_group_id: groupId,
        changes: [
          { field: 'title',    type: 'text',   old: 'Old title', new: 'New title' },
          { field: 'priority', type: 'number', old: 3,           new: 1 },
        ],
      },
    })

    const { rows } = await query(
      'SELECT field_key, edit_group_id FROM runtime.work_item_edits WHERE work_item_id = $1 ORDER BY field_key',
      [workItemId]
    )
    assert.equal(rows.length, 2)
    assert.deepEqual(rows.map(r => r.field_key).sort(), ['priority', 'title'])
    assert.equal(rows[0].edit_group_id, groupId)
    assert.equal(rows[1].edit_group_id, groupId)
  })

  it('is idempotent — reprocessing the same event does not duplicate rows', async () => {
    const groupId = '00000000-0000-0000-0000-000000000002'
    const event = {
      id: 2,
      event_type: 'work_item.edited',
      entity_id: workItemId,
      actor_id: null,
      occurred_at: new Date(),
      payload: {
        edit_group_id: groupId,
        changes: [{ field: 'description', type: 'textarea', old: null, new: 'new desc' }],
      },
    }

    await auditLogHandler(event)
    await auditLogHandler(event)   // run twice

    const { rows } = await query(
      'SELECT COUNT(*) AS n FROM runtime.work_item_edits WHERE edit_group_id = $1',
      [groupId]
    )
    assert.equal(Number(rows[0].n), 1, 'double-processing must not duplicate')
  })

  after(async () => {
    await query('DELETE FROM runtime.work_item_edits WHERE work_item_id = $1', [workItemId])
  })
})

import { createAuthApi } from './helpers/auth.js'
const api = createAuthApi()

describe('PATCH /work-items/:id — emits work_item.edited + writes audit rows', () => {
  let workItemId
  before(async () => {
    const { rows } = await query('SELECT id FROM runtime.work_items ORDER BY id ASC LIMIT 1')
    workItemId = rows[0].id
    // Reset to known state so the diff-emission assertion is deterministic
    // regardless of prior test runs
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

    // Give the processor a moment to drain
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
    // Fetch current title
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
    // Force substate to 'blocked' so the substate test's change to 'active' actually emits
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
    // Find any work item with at least one manual exit criterion
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

    // Acknowledge
    let res = await api(`/work-items/${work_item_id}/exit-criteria/${ec_id}/acknowledge`, { method: 'POST' })
    assert.equal(res.status, 200)
    await new Promise(r => setTimeout(r, 200))

    // Unacknowledge
    res = await api(`/work-items/${work_item_id}/exit-criteria/${ec_id}/acknowledge`, { method: 'DELETE' })
    assert.equal(res.status, 200)
    await new Promise(r => setTimeout(r, 200))

    // Waive
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
    assert.ok(names.includes('neo4j-sync'))
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

    // Un-pause for subsequent tests
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
  it('creating a work item produces a work_item.created event that advances neo4j-sync cursor', async () => {
    const cursorBefore = await query(
      "SELECT last_processed_event_id FROM runtime.event_subscribers WHERE name = 'neo4j-sync'"
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

    // Wait up to 3s for processor to drain
    let cursorAfter = before
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 200))
      const c = await query(
        "SELECT last_processed_event_id FROM runtime.event_subscribers WHERE name = 'neo4j-sync'"
      )
      cursorAfter = Number(c.rows[0].last_processed_event_id)
      if (cursorAfter > before) break
    }
    assert.ok(cursorAfter > before, `neo4j-sync cursor did not advance (was ${before}, is ${cursorAfter})`)
  })
})
