import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { query, getClient } from '../db/postgres.js'
import { emitEvent } from '../core/events.js'

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
