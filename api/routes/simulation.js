/**
 * api/routes/simulation.js
 * REST endpoints for controlling the simulation engine.
 * Mounted at /admin/api/simulation
 */

import { Router } from 'express'
import { orchestrator }       from '../../simulation/orchestrator.js'
import { getActivityBuffer, activitySSEHandler } from '../../simulation/activityLog.js'

const router = Router()

// POST /start — start simulation
router.post('/start', async (req, res) => {
  const { speed, agents } = req.body || {}
  const result = await orchestrator.start({ speed, agents })
  if (result.error) return res.status(400).json(result)
  res.json(result)
})

// POST /stop — stop simulation
router.post('/stop', (_req, res) => {
  const result = orchestrator.stop()
  if (result.error) return res.status(400).json(result)
  res.json(result)
})

// POST /pause — pause simulation
router.post('/pause', (_req, res) => {
  const result = orchestrator.pause()
  if (result.error) return res.status(400).json(result)
  res.json(result)
})

// POST /resume — resume simulation
router.post('/resume', (_req, res) => {
  const result = orchestrator.resume()
  if (result.error) return res.status(400).json(result)
  res.json(result)
})

// PUT /speed — set tick speed multiplier
router.put('/speed', (req, res) => {
  const { speed } = req.body || {}
  if (!speed || speed < 1 || speed > 10) {
    return res.status(400).json({ error: 'speed must be between 1 and 10' })
  }
  res.json(orchestrator.setSpeed(speed))
})

// GET /status — current simulation state
router.get('/status', (_req, res) => {
  res.json(orchestrator.status())
})

// GET /stream — SSE activity feed
router.get('/stream', activitySSEHandler)

// GET /activity — buffered activity entries
router.get('/activity', (_req, res) => {
  res.json({ entries: getActivityBuffer() })
})

export default router
