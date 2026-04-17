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
