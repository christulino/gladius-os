/**
 * runtime/notifications/ownershipChallenge.js
 * POSTs { type:'gladius.verify', token } to a URL and verifies the response
 * JSON body echoes the same token. Used to gate webhook / agent channel
 * activation against the amplifier attack.
 */

import crypto from 'node:crypto'

export function generateToken() {
  return crypto.randomBytes(24).toString('hex')
}

export async function runChallenge({ url, timeoutMs = 10000, token = generateToken() }) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'gladius.verify', token }),
    })
    if (!res.ok) return { ok: false, reason: `status=${res.status}` }
    const body = await res.json().catch(() => ({}))
    if (body?.token !== token) return { ok: false, reason: 'token-mismatch' }
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: e.name === 'AbortError' ? 'timeout' : (e.message || 'error') }
  } finally {
    clearTimeout(t)
  }
}

export default { generateToken, runChallenge }
