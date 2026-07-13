import { describe, it, after } from 'node:test'
import { closePool } from './helpers/poolTeardown.js'
import assert from 'node:assert/strict'
import { getClient } from '../db/postgres.js'
import { startDeliveryWorker, stopDeliveryWorker } from '../runtime/deliveryWorker.js'

const LOCK_KEY = 252727380

describe('deliveryWorker tick() scheduling under advisory-lock contention', () => {
  it('schedules exactly one timer per tick when the lock is held elsewhere', async () => {
    const lockHolder = await getClient()
    const { rows } = await lockHolder.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY])
    const weHoldIt = rows[0].ok

    const realSetTimeout = global.setTimeout
    let scheduleCount = 0
    global.setTimeout = (fn, ms, ...rest) => {
      scheduleCount++
      return realSetTimeout(fn, ms, ...rest)
    }

    try {
      await startDeliveryWorker()
      // Give the first tick's async acquireLock() query time to resolve and
      // reach its scheduling point, well short of the real pollMs interval.
      await new Promise(resolve => realSetTimeout(resolve, 300))
    } finally {
      global.setTimeout = realSetTimeout
      await stopDeliveryWorker()
      if (weHoldIt) await lockHolder.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY])
      lockHolder.release()
    }

    assert.equal(scheduleCount, 1, 'expected exactly one setTimeout scheduled per contended tick, got a double-schedule')
  })
})

// Close the shared PG pool so this test process can exit cleanly (DEBT.26643).
after(closePool)
