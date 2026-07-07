/**
 * tests/helpers/dogfoodGuard.js
 *
 * Structural guard: refuses mutating HTTP requests aimed at the live dogfood
 * org (109 by default). Wired into tests/helpers/auth.js's createAuthApi()
 * so it applies to every test that uses the shared session-auth client,
 * without each test file having to remember to opt in.
 *
 * WHY: Integration tests wrote 47 junk work items into dogfood org 109
 * because some test files hardcoded owner_org_id=109 (or defaulted
 * GLADIUS_TEST_ORG_ID to '109'). Cleanup-after hooks are leaky (process
 * kill, throw before the id is captured, swallowed errors) — this guard is
 * structural: it rejects the write before it reaches the server, with an
 * error that names the offending org and points at the fix.
 *
 * Tests should create their own throwaway org via createTestOrg()
 * (tests/helpers/testOrg.js) and pass that orgId instead.
 *
 * Coverage: this only inspects requests made through createAuthApi()'s
 * `api()` wrapper (the dominant write path — work-item creation and
 * organization-scoped endpoints both carry the org id in the body or path).
 * Ad-hoc `fetch()`/Bearer-auth helpers defined inline in individual test
 * files are NOT covered; see DEBT.26608 follow-up note on the work item.
 */

export const DOGFOOD_ORG_ID = parseInt(process.env.GLADIUS_DOGFOOD_ORG_ID || '109', 10)

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Throws if `path`/`options` describe a mutating request targeting the
 * dogfood org. No-op for GET/HEAD requests or requests that don't reference
 * the dogfood org.
 *
 * @param {string} path - request path, may include a leading base URL
 * @param {{ method?: string, body?: string }} options - fetch-style options
 */
export function assertNotDogfoodWrite(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  if (!MUTATING_METHODS.has(method)) return

  const fail = (reason) => {
    throw new Error(
      `Test guard: refused ${method} ${path} — ${reason} dogfood org ${DOGFOOD_ORG_ID}. ` +
      `Use createTestOrg() from tests/helpers/testOrg.js instead of writing to the dogfood org.`
    )
  }

  // Org id embedded in the path, e.g. /organizations/109/playbooks/5
  const pathMatch = path.match(/\/organizations\/(\d+)(?:\/|$)/)
  if (pathMatch && parseInt(pathMatch[1], 10) === DOGFOOD_ORG_ID) {
    fail('path targets')
  }

  // Org id embedded in the query string, e.g. ?org_id=109
  const qsMatch = path.match(/[?&]org_id=(\d+)(?:&|$)/)
  if (qsMatch && parseInt(qsMatch[1], 10) === DOGFOOD_ORG_ID) {
    fail('query string targets')
  }

  // Org id embedded in a JSON body, e.g. { owner_org_id: 109 }
  if (typeof options.body === 'string') {
    let parsed
    try { parsed = JSON.parse(options.body) } catch { parsed = null }
    if (parsed && typeof parsed === 'object') {
      const bodyOrgId = parsed.owner_org_id ?? parsed.org_id
      if (bodyOrgId === DOGFOOD_ORG_ID || bodyOrgId === String(DOGFOOD_ORG_ID)) {
        fail('request body targets')
      }
    }
  }
}
