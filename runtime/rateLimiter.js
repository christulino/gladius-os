/**
 * runtime/rateLimiter.js
 * Two primitives used by the delivery worker:
 *   - HostRateLimiter: in-memory sliding window keyed by host
 *   - Semaphore: bounded concurrency
 */

export class HostRateLimiter {
  constructor({ windowMs, cap }) {
    this.windowMs = windowMs
    this.cap = cap
    this.buckets = new Map()
  }
  allow(host) {
    const now = Date.now()
    const cutoff = now - this.windowMs
    const bucket = this.buckets.get(host) ?? []
    const kept = bucket.filter(t => t > cutoff)
    if (kept.length >= this.cap) {
      this.buckets.set(host, kept)
      return false
    }
    kept.push(now)
    this.buckets.set(host, kept)
    return true
  }
}

export class Semaphore {
  constructor(n) {
    this.capacity = n
    this.available = n
    this.waiters = []
  }
  acquire() {
    if (this.available > 0) {
      this.available--
      return Promise.resolve()
    }
    return new Promise(resolve => this.waiters.push(resolve))
  }
  release() {
    const w = this.waiters.shift()
    if (w) w()
    else this.available++
  }
}

/**
 * Per-(user, channel) send rate — computed from the deliveries table itself.
 * Returns { allowed:boolean, retryAfterMs?:number }.
 */
export async function checkUserChannelRate({ query, userId, channel, perMinute, perHour }) {
  const { rows } = await query(`
    SELECT
      count(*) FILTER (WHERE d.sent_at > now() - interval '1 minute') AS last_min,
      count(*) FILTER (WHERE d.sent_at > now() - interval '1 hour')   AS last_hour
    FROM runtime.notification_deliveries d
    JOIN runtime.notifications n ON n.id = d.notification_id
    WHERE n.user_id = $1 AND d.channel = $2
  `, [userId, channel])
  const { last_min, last_hour } = rows[0]
  if (Number(last_min)  >= perMinute) return { allowed: false, retryAfterMs: 60_000 }
  if (Number(last_hour) >= perHour)   return { allowed: false, retryAfterMs: 60 * 60_000 }
  return { allowed: true }
}

export default { HostRateLimiter, Semaphore, checkUserChannelRate }
