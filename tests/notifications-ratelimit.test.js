import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Semaphore } from '../runtime/rateLimiter.js'

describe('rateLimiter — semaphore', () => {
  it('limits concurrency', async () => {
    const sem = new Semaphore(2)
    let active = 0, peak = 0
    async function work() {
      await sem.acquire()
      active++; peak = Math.max(peak, active)
      await new Promise(r => setTimeout(r, 20))
      active--
      sem.release()
    }
    await Promise.all([work(), work(), work(), work(), work()])
    assert.equal(peak, 2)
  })
})
