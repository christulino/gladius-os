import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { HostRateLimiter, Semaphore } from '../runtime/rateLimiter.js'

describe('rateLimiter — per-host sliding window', () => {
  it('allows up to cap in one window, then denies', () => {
    const rl = new HostRateLimiter({ windowMs: 1000, cap: 3 })
    assert.equal(rl.allow('a.com'), true)
    assert.equal(rl.allow('a.com'), true)
    assert.equal(rl.allow('a.com'), true)
    assert.equal(rl.allow('a.com'), false)
  })
  it('tracks per-host independently', () => {
    const rl = new HostRateLimiter({ windowMs: 1000, cap: 1 })
    assert.equal(rl.allow('a.com'), true)
    assert.equal(rl.allow('b.com'), true)
    assert.equal(rl.allow('a.com'), false)
  })
  it('evicts after window elapses', async () => {
    const rl = new HostRateLimiter({ windowMs: 50, cap: 1 })
    rl.allow('a.com')
    await new Promise(r => setTimeout(r, 80))
    assert.equal(rl.allow('a.com'), true)
  })
})

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
