/**
 * tests/single-org-mode.test.js
 * FEAT.26604 — Single-org public experience.
 *
 * Verifies GET /auth/status exposes `multiOrgEnabled` driven by the
 * GLADIUS_MULTI_ORG env var: default (unset) is false (single-org UI),
 * and explicitly setting it to 'true' flips it on (dogfood's path to
 * keeping the current multi-org UI unchanged).
 *
 * Spawns two short-lived server instances on alt ports with different
 * env so both branches of the flag are actually exercised, rather than
 * relying on whatever the currently-running dev server happens to have set.
 */

import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

const HEALTH_TIMEOUT_MS = 15000

async function waitForHealth(port) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/health`)
      if (res.ok) return
    } catch {
      // not up yet
    }
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error(`Server on port ${port} did not become healthy in time`)
}

function startServer(port, extraEnv) {
  const child = spawn(process.execPath, ['api/server.js'], {
    env: { ...process.env, PORT: String(port), ...extraEnv },
    stdio: 'ignore',
  })
  return child
}

function stopServer(child) {
  if (!child || child.killed) return
  // SIGKILL, not SIGTERM: api/server.js's SIGTERM handler stops background
  // workers but doesn't call process.exit(), so SIGTERM alone would leave
  // these throwaway test servers running as orphans on the alt ports.
  child.kill('SIGKILL')
}

describe('Single-org mode flag (FEAT.26604)', () => {
  let offServer
  let onServer
  const OFF_PORT = 3021
  const ON_PORT = 3022

  after(() => {
    stopServer(offServer)
    stopServer(onServer)
  })

  it('defaults multiOrgEnabled to false when GLADIUS_MULTI_ORG is unset', async () => {
    offServer = startServer(OFF_PORT, { GLADIUS_MULTI_ORG: '' })
    await waitForHealth(OFF_PORT)

    const res = await fetch(`http://localhost:${OFF_PORT}/auth/status`)
    const data = await res.json()

    assert.equal(res.status, 200)
    assert.equal(data.multiOrgEnabled, false)
  })

  it('sets multiOrgEnabled to true when GLADIUS_MULTI_ORG=true (dogfood path)', async () => {
    onServer = startServer(ON_PORT, { GLADIUS_MULTI_ORG: 'true' })
    await waitForHealth(ON_PORT)

    const res = await fetch(`http://localhost:${ON_PORT}/auth/status`)
    const data = await res.json()

    assert.equal(res.status, 200)
    assert.equal(data.multiOrgEnabled, true)
  })
})
