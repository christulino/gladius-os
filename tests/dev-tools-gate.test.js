import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// core/devTools.js reads process.env.GLADIUS_DEV_TOOLS once at module-eval
// time, so each case forces a fresh module instance (cache-busting query
// string) after setting the env var, rather than mutating an already-loaded
// module's frozen export.

describe('GLADIUS_DEV_TOOLS gate (DEBT.26605)', () => {
  it('requireDevTools 404s when the flag is unset (default install)', async () => {
    delete process.env.GLADIUS_DEV_TOOLS
    const { requireDevTools, DEV_TOOLS_ENABLED } = await import(`../core/devTools.js?case=unset-${Date.now()}`)

    assert.equal(DEV_TOOLS_ENABLED, false)

    let statusCode, body, nextCalled = false
    const res = {
      status(code) { statusCode = code; return this },
      json(payload) { body = payload; return this },
    }
    requireDevTools({}, res, () => { nextCalled = true })

    assert.equal(statusCode, 404)
    assert.deepEqual(body, { error: 'Route not found' })
    assert.equal(nextCalled, false)
  })

  it('requireDevTools 404s when the flag is set to a non-"true" value', async () => {
    process.env.GLADIUS_DEV_TOOLS = '1'
    const { requireDevTools } = await import(`../core/devTools.js?case=truthy-${Date.now()}`)

    let statusCode, nextCalled = false
    const res = { status(code) { statusCode = code; return this }, json() { return this } }
    requireDevTools({}, res, () => { nextCalled = true })

    assert.equal(statusCode, 404)
    assert.equal(nextCalled, false)
    delete process.env.GLADIUS_DEV_TOOLS
  })

  it('requireDevTools calls next() and does not 404 when GLADIUS_DEV_TOOLS=true', async () => {
    process.env.GLADIUS_DEV_TOOLS = 'true'
    const { requireDevTools, DEV_TOOLS_ENABLED } = await import(`../core/devTools.js?case=enabled-${Date.now()}`)

    assert.equal(DEV_TOOLS_ENABLED, true)

    let nextCalled = false
    const res = { status() { throw new Error('should not 404 when Dev Tools are enabled') } }
    requireDevTools({}, res, () => { nextCalled = true })

    assert.equal(nextCalled, true)
    delete process.env.GLADIUS_DEV_TOOLS
  })
})
