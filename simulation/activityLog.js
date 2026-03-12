/**
 * simulation/activityLog.js
 * In-memory ring buffer for simulation activity + SSE broadcast.
 * Pattern matches admin/logger.js.
 */

const BUFFER_SIZE = 500
const buffer      = []
const sseClients  = new Set()
let nextId        = 1

/**
 * Log a simulation activity entry.
 */
export function logActivity(agentName, action, detail, workItemId = null) {
  const entry = {
    id:         nextId++,
    timestamp:  new Date().toISOString(),
    agentName,
    action,
    detail,
    workItemId,
  }

  if (buffer.length >= BUFFER_SIZE) buffer.shift()
  buffer.push(entry)

  broadcast(entry)
  return entry
}

/**
 * Get the current activity buffer.
 */
export function getActivityBuffer() {
  return [...buffer]
}

/**
 * Clear the activity buffer.
 */
export function clearActivityBuffer() {
  buffer.length = 0
}

/**
 * SSE handler for simulation activity stream.
 * GET /admin/api/simulation/stream
 */
export function activitySSEHandler(req, res) {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  // Send buffer snapshot on connect
  for (const entry of buffer) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`)
  }

  const ping = setInterval(() => {
    try { res.write(': ping\n\n') } catch { cleanup() }
  }, 15000)

  sseClients.add(res)

  function cleanup() {
    clearInterval(ping)
    sseClients.delete(res)
  }

  req.on('close', cleanup)
  req.on('aborted', cleanup)
}

function broadcast(entry) {
  if (sseClients.size === 0) return
  const data = `data: ${JSON.stringify(entry)}\n\n`
  for (const res of sseClients) {
    try { res.write(data) } catch { sseClients.delete(res) }
  }
}
