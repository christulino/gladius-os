/**
 * core/devTools.js
 * Gate for developer-only surfaces (Raw Tables, DB Console, Log Viewer,
 * Simulation) that read as hobby-project scaffolding to non-dev users.
 *
 * Off by default. Enable with GLADIUS_DEV_TOOLS=true in .env.
 */

export const DEV_TOOLS_ENABLED = process.env.GLADIUS_DEV_TOOLS === 'true'

/**
 * Express middleware — 404s any dev-tools-only route when the flag is off,
 * so the route is genuinely absent (not just hidden in the nav) by default.
 */
export function requireDevTools(req, res, next) {
  if (!DEV_TOOLS_ENABLED) return res.status(404).json({ error: 'Route not found' })
  next()
}
