/**
 * tests/helpers/auth.js
 * Shared test authentication helper.
 *
 * Handles the setup-or-login flow so tests can get an authenticated session cookie.
 * On first run against a fresh DB (no users with passwords), runs setup.
 * On subsequent runs, logs in with the test account.
 */

import { assertNotDogfoodWrite } from './dogfoodGuard.js'

const BASE = process.env.API_URL || 'http://localhost:3000'

const TEST_USER = {
  email:        'test@flowos.dev',
  password:     'testpassword123',
  display_name: 'Test User',
}

let cachedCookie = null

/**
 * Get a session cookie for authenticated API requests.
 * Caches the cookie for the lifetime of the test process.
 */
export async function getSessionCookie() {
  if (cachedCookie) return cachedCookie

  // Check auth status
  const statusRes = await fetch(`${BASE}/auth/status`)
  const status = await statusRes.json()

  if (status.needsSetup) {
    // First run — create admin user via setup
    const setupRes = await fetch(`${BASE}/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(TEST_USER),
    })
    if (!setupRes.ok) {
      const err = await setupRes.json()
      throw new Error(`Setup failed: ${err.error}`)
    }
    cachedCookie = setupRes.headers.get('set-cookie')
  } else {
    // Login with existing test account
    const loginRes = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_USER.email, password: TEST_USER.password }),
    })
    if (!loginRes.ok) {
      const err = await loginRes.json()
      throw new Error(`Login failed: ${err.error}. You may need to re-seed: npm run seed && run setup.`)
    }
    cachedCookie = loginRes.headers.get('set-cookie')
  }

  if (!cachedCookie) throw new Error('No session cookie returned from auth')
  return cachedCookie
}

/**
 * Create a fetch wrapper that includes the session cookie.
 */
export function createAuthApi(basePath = `${BASE}/admin/api`) {
  return async function api(path, options = {}) {
    assertNotDogfoodWrite(path, options)
    const cookie = await getSessionCookie()
    const res = await fetch(basePath + path, {
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie,
        ...options.headers,
      },
      ...options,
    })
    const data = await res.json()
    return { status: res.status, data }
  }
}
