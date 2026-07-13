// Processor-level tests for the event system.
//
// The 'cursor and drain' tests call startProcessor({ forceTakeLock: true }) and
// will be skipped/fail gracefully if a live API server already holds the advisory
// lock. For endpoint-level tests that require the server, see events-integration.test.js.

import { describe, it, before, after } from 'node:test'
import { closePool } from './helpers/poolTeardown.js'
import assert from 'node:assert/strict'
import { query, getClient } from '../db/postgres.js'
import { emitEvent } from '../core/events.js'
import {
  startProcessor,
  stopProcessor,
  registerSubscriber,
  clearSubscribersForTests,
  drainNow,
  isProcessorPrimary,
} from '../runtime/eventProcessor.js'
import { auditLogHandler } from '../runtime/subscribers/auditLog.js'

describe('core/events.js — emitEvent', () => {
  before(async () => {
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

  it('advances subscriber cursor after successful handler', async (t) => {
    const seen = []
    registerSubscriber({
      name: 'test-cursor-advance',
      handles: (type) => type === 'test.cursor_a',
      handler: async (e) => { seen.push(e.id) },
    })
    await startProcessor({ forceTakeLock: true })
    if (!isProcessorPrimary()) { t.skip('server holds advisory lock — run without server'); return }

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

  it('leaves cursor at N-1 when handler throws on event N', async (t) => {
    if (!isProcessorPrimary()) { t.skip('server holds advisory lock — run without server'); return }
    registerSubscriber({
      name: 'test-failure',
      handles: (type) => type === 'test.fail_on_second',
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

  it('dead-letters a poison event after DEAD_LETTER_THRESHOLD consecutive failures', async (t) => {
    if (!isProcessorPrimary()) { t.skip('server holds advisory lock — run without server'); return }

    registerSubscriber({
      name: 'test-dead-letter',
      handles: (type) => type === 'test.poison',
      handler: async (_e) => { throw new Error('always fails') },
    })

    const client = await getClient()
    let poisonEventId
    try {
      await client.query('BEGIN')
      poisonEventId = await emitEvent(client, {
        eventType: 'test.poison',
        entityId:  1,
        payload:   { x: 1 },
      })
      await client.query('COMMIT')
    } finally { client.release() }

    // Each drainNow() is one retry tick; threshold is 5
    for (let i = 0; i < 5; i++) await drainNow()

    const { rows } = await query(
      'SELECT last_processed_event_id, failure_count, last_error FROM runtime.event_subscribers WHERE name = $1',
      ['test-dead-letter']
    )
    assert.equal(Number(rows[0].last_processed_event_id), Number(poisonEventId),
      'cursor must advance past the poison event after dead-lettering')
    assert.equal(Number(rows[0].failure_count), 0,
      'failure_count reset after dead-letter')
    assert.match(rows[0].last_error, /always fails/,
      'last_error preserved for dead-letter visibility')
  })

  it('skips past events a subscriber does not handle (advances cursor without calling handler)', async (t) => {
    if (!isProcessorPrimary()) { t.skip('server holds advisory lock — run without server'); return }
    const handled = []
    registerSubscriber({
      name: 'test-filter',
      handles: (type) => type === 'test.want_this',
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

describe('subscribers/auditLog — writes work_item_edits rows', () => {
  let workItemId

  before(async () => {
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
    await auditLogHandler(event)

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

// Close the shared PG pool so this test process can exit cleanly (DEBT.26643).
after(closePool)
