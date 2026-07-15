/**
 * core/cors.js
 * Hand-rolled CORS middleware (no `cors` dependency — DEBT.26613).
 *
 * Default (GLADIUS_CORS_ORIGINS unset/empty): emit NO CORS headers. The API and
 * admin SPA are served same-origin, so cross-origin headers are unnecessary and
 * omitting them is the safest default.
 *
 * When GLADIUS_CORS_ORIGINS is set (comma-separated absolute origins), an
 * incoming request whose Origin is in the allowlist gets its origin reflected
 * back with credentials allowed. Preflight OPTIONS is answered with 204.
 *
 * A wildcard `*` is NEVER emitted together with credentials (browsers forbid it
 * and it would be a security hole). Requests from disallowed origins simply
 * receive no CORS headers.
 */

function parseAllowedOrigins(env) {
  return String(env.GLADIUS_CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function createCorsMiddleware(env = process.env) {
  const allowed = parseAllowedOrigins(env)

  return function corsMiddleware(req, res, next) {
    // Same-origin default: no allowlist configured → emit nothing.
    if (allowed.length === 0) return next()

    const origin = req.headers.origin

    if (origin && allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Access-Control-Allow-Credentials', 'true')
      res.setHeader('Vary', 'Origin')

      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
        res.setHeader(
          'Access-Control-Allow-Headers',
          req.headers['access-control-request-headers'] || 'Content-Type,Authorization'
        )
        res.setHeader('Access-Control-Max-Age', '600')
        return res.status(204).end()
      }
    }

    next()
  }
}
