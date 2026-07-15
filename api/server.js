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
import { mkdir }    from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import 'dotenv/config'
import { initLogger }                 from '../admin/logger.js'
import { healthCheck as pgHealth }    from '../db/postgres.js'
import { createSessionMiddleware, requireAuth } from '../core/auth.js'
import { DEV_TOOLS_ENABLED, requireDevTools }   from '../core/devTools.js'
import authRoutes       from './routes/auth.js'
import adminApiRoutes   from '../admin/api.js'
import simulationRoutes from './routes/simulation.js'
import { startProcessor } from '../runtime/eventProcessor.js'
import { startDeliveryWorker, stopDeliveryWorker } from '../runtime/deliveryWorker.js'
import { startRetentionJob, stopRetentionJob } from '../runtime/jobs/notificationRetention.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Patch console before anything else logs — only when Dev Tools are enabled.
// Default install: plain console, nothing captured, nothing intercepted.
if (DEV_TOOLS_ENABLED) initLogger()

const app  = express()
const PORT = process.env.PORT || 3000

// Ensure uploads directory exists
const uploadsDir = join(__dirname, '../public/uploads/avatars')
mkdir(uploadsDir, { recursive: true }).catch(() => {})

// =============================================================================
// MIDDLEWARE
// =============================================================================

app.use(express.json())

// Session middleware — must come before any route that reads req.session
app.use(createSessionMiddleware())

// Request logger — always captured to log buffer, printed in debug mode
app.use((req, _res, next) => {
  const msg = `[api] ${req.method} ${req.path}`
  if (process.env.LOG_LEVEL === 'debug') console.debug(msg)
  else console.log(msg)
  next()
})

// =============================================================================
// ROUTES
// =============================================================================

// Public routes — no requireAuth
app.use('/auth',             authRoutes)

// All API routes require authentication
app.use('/admin/api/simulation', requireDevTools, requireAuth, simulationRoutes)
app.use('/admin/api',            requireAuth, adminApiRoutes)

// Serve uploaded files (avatars, etc.)
app.use('/uploads', express.static(join(__dirname, '../public/uploads')))

// Serve React admin UI from admin-ui/dist
// Falls back gracefully if build doesn't exist yet
const adminDist = join(__dirname, '../admin-ui/dist')
app.use('/admin', express.static(adminDist))
app.get('/admin/*', (_req, res) => {
  res.sendFile(join(adminDist, 'index.html'), err => {
    if (err) res.status(503).send('Admin UI not built yet. Run: cd admin-ui && npm run build')
  })
})

// Health check
app.get('/health', async (_req, res) => {
  const postgres = await pgHealth()
  res.status(postgres ? 200 : 503).json({
    status:   postgres ? 'ok' : 'degraded',
    postgres,
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

app.listen(PORT, async () => {
  console.log(`[api] Gladius running on port ${PORT} (${process.env.NODE_ENV || 'development'})`)
  console.log(`[api] Health: http://localhost:${PORT}/health`)
  try {
    await startProcessor()
    console.log('[events] Processor started')
  } catch (err) {
    console.error('[events] Processor failed to start:', err.message)
  }
  try {
    await startDeliveryWorker()
    console.log('[notifications] Delivery worker started')
  } catch (err) {
    console.error('[notifications] Delivery worker failed to start:', err.message)
  }
  try {
    await startRetentionJob()
    console.log('[notifications] Retention job started')
  } catch (err) {
    console.error('[notifications] Retention job failed to start:', err.message)
  }
})

// =============================================================================
// SHUTDOWN
// =============================================================================

let shuttingDown = false

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[api] ${signal} received, shutting down...`)
  try {
    await stopDeliveryWorker()
    stopRetentionJob()
    console.log('[api] Shutdown cleanup complete')
    process.exit(0)
  } catch (err) {
    console.error('[api] Error during shutdown cleanup:', err.message)
    process.exit(1)
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))

export default app
