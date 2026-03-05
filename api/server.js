/**
 * api/server.js
 * Express REST API server.
 *
 * Thin layer — routes receive requests, validate inputs,
 * call domain modules, return results. No business logic here.
 *
 * Start: node api/server.js
 * Dev:   node --watch api/server.js
 */

import express      from 'express'
import 'dotenv/config'
import { healthCheck as pgHealth }    from '../db/postgres.js'
import { healthCheck as neo4jHealth } from '../db/neo4j.js'
import workItemRoutes   from './routes/workItems.js'
import orgRoutes        from './routes/organizations.js'
import catalogRoutes    from './routes/catalog.js'
import boardRoutes      from './routes/board.js'

const app  = express()
const PORT = process.env.PORT || 3000

// =============================================================================
// MIDDLEWARE
// =============================================================================

app.use(express.json())

// Request logger
app.use((req, _res, next) => {
  if (process.env.LOG_LEVEL === 'debug') {
    console.debug(`[api] ${req.method} ${req.path}`)
  }
  next()
})

// =============================================================================
// ROUTES
// =============================================================================

app.use('/v1/work-items',    workItemRoutes)
app.use('/v1/organizations', orgRoutes)
app.use('/v1/catalog',       catalogRoutes)
app.use('/v1/board',         boardRoutes)

// Health check
app.get('/health', async (_req, res) => {
  const [postgres, neo4j] = await Promise.all([pgHealth(), neo4jHealth()])
  const healthy = postgres && neo4j
  res.status(healthy ? 200 : 503).json({
    status:   healthy ? 'ok' : 'degraded',
    postgres,
    neo4j,
    version:  '0.1.0',
    timestamp: new Date().toISOString(),
  })
})

// =============================================================================
// ERROR HANDLING
// =============================================================================

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' })
})

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[api] Unhandled error:', err)
  const status  = err.status || err.statusCode || 500
  const message = err.expose ? err.message : 'Internal server error'
  res.status(status).json({ error: message })
})

// =============================================================================
// START
// =============================================================================

app.listen(PORT, () => {
  console.log(`[api] Flow OS running on port ${PORT} (${process.env.NODE_ENV || 'development'})`)
  console.log(`[api] Health: http://localhost:${PORT}/health`)
})

export default app
