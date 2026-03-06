/**
 * admin/logger.js
 * In-memory log capture with SSE broadcast.
 *
 * Patches console.log/warn/error/debug to:
 *   1. Write to stdout as normal
 *   2. Push to a ring buffer (last 500 entries)
 *   3. Broadcast to all connected SSE clients
 *
 * Usage:
 *   import { initLogger } from '../admin/logger.js'
 *   initLogger()  // call once at server startup, before anything else logs
 *
 * SSE endpoint: GET /admin/api/logs/stream
 * Buffer fetch:  GET /admin/api/logs
 */

const BUFFER_SIZE = 500
const logBuffer   = []       // ring buffer
const sseClients  = new Set() // active SSE response objects

/**
 * Patch console methods and start capturing.
 * Safe to call multiple times — only patches once.
 */
let patched = false
export function initLogger() {
  if (patched) return
  patched = true

  const methods = ['log', 'info', 'warn', 'error', 'debug']
  methods.forEach(level => {
    const original = console[level].bind(console)
    console[level] = (...args) => {
      original(...args)
      capture(level, args)
    }
  })
}

function capture(level, args) {
  const entry = {
    id:        logBuffer.length,
    ts:        new Date().toISOString(),
    level,
    message:   args.map(a =>
      typeof a === 'object' ? JSON.stringify(a, null, 0) : String(a)
    ).join(' '),
  }

  // Ring buffer — drop oldest when full
  if (logBuffer.length >= BUFFER_SIZE) logBuffer.shift()
  logBuffer.push(entry)

  // Broadcast to all connected SSE clients
  broadcast(entry)
}

function broadcast(entry) {
  if (sseClients.size === 0) return
  const data = `data: ${JSON.stringify(entry)}\n\n`
  for (const res of sseClients) {
    try { res.write(data) } catch { sseClients.delete(res) }
  }
}

/**
 * Returns the current log buffer (most recent entries last).
 */
export function getBuffer() {
  return [...logBuffer]
}

/**
 * Express route handler for SSE log stream.
 * GET /admin/api/logs/stream
 */
export function sseHandler(req, res) {
  res.setHeader('Content-Type',  'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection',    'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  // Send buffer snapshot on connect
  for (const entry of logBuffer) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`)
  }

  // Keep-alive ping every 15s
  const ping = setInterval(() => {
    try { res.write(': ping\n\n') } catch { cleanup() }
  }, 15000)

  sseClients.add(res)

  function cleanup() {
    clearInterval(ping)
    sseClients.delete(res)
  }

  req.on('close',   cleanup)
  req.on('aborted', cleanup)
}

export default { initLogger, getBuffer, sseHandler }
