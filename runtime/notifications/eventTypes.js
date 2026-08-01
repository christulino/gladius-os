/**
 * runtime/notifications/eventTypes.js
 *
 * The set of event types the notification system can act on, derived from the
 * database rather than hardcoded.
 *
 * WHY: this set used to be a literal `HANDLED` Set in subscribers/
 * notifications.js that a human had to keep in sync with the
 * blueprint.notification_defaults seed — CLAUDE.md carried an explicit "keep in
 * sync with the seed in migration 012" warning, which is a standing invitation
 * to exactly one bug. It duly happened: migration 017 seeded four
 * `work_item.context_entry_added` defaults, the literal never gained the entry,
 * and the result was a notification users could switch on in the UI that
 * silently reached nobody. No error anywhere. Deriving the set removes the
 * hand-sync step, so a migration that seeds a new default is sufficient on its
 * own.
 *
 * SOURCE OF TRUTH is the union of:
 *   - blueprint.notification_defaults      (what ships enabled/disabled by default)
 *   - blueprint.user_notification_overrides (what a user has explicitly set)
 * The union matters: a user override for an event type with no default row
 * would otherwise be unreachable — the predicate would skip the event before
 * the matrix ever got to honour the override.
 *
 * CACHING: the predicate runs per event in the processor drain loop, so it is
 * cached in-process with a short TTL. The set only changes when a migration
 * seeds a default or a user saves a preference, so staleness is bounded by
 * TTL_MS and self-heals.
 *
 * FAILURE POLICY: fail OPEN. If the lookup fails, callers are told the event
 * IS notifiable so the async handler runs and re-resolves it properly. Failing
 * closed would silently drop notifications on a transient DB blip — the exact
 * class of silent failure this module exists to remove.
 */

import { query } from '../../db/postgres.js'

const TTL_MS = 60_000

let cache = null        // Set<string>
let cachedAt = 0
let inFlight = null     // de-dupes concurrent refreshes

/** Clear the cache. Tests use this after seeding a new default row. */
export function invalidateEventTypeCache() {
  cache = null
  cachedAt = 0
  inFlight = null
}

async function fetchEventTypes() {
  const { rows } = await query(`
    SELECT event_type FROM blueprint.notification_defaults
    UNION
    SELECT event_type FROM blueprint.user_notification_overrides
  `)
  return new Set(rows.map(r => r.event_type))
}

/**
 * The current notifiable event-type set, refreshing the cache when stale.
 * Throws only if the underlying query throws AND there is no cached value to
 * fall back on — callers decide the failure policy.
 *
 * @returns {Promise<Set<string>>}
 */
export async function getNotifiableEventTypes() {
  const fresh = cache && (Date.now() - cachedAt) < TTL_MS
  if (fresh) return cache

  // Collapse concurrent refreshes into one query.
  if (!inFlight) {
    inFlight = fetchEventTypes()
      .then(set => {
        cache = set
        cachedAt = Date.now()
        return set
      })
      .finally(() => { inFlight = null })
  }

  try {
    return await inFlight
  } catch (err) {
    // Serve a stale set rather than nothing — better a slightly old answer
    // than a dropped notification.
    if (cache) {
      console.warn(`[notifications] event-type refresh failed, serving stale set: ${err.message}`)
      return cache
    }
    throw err
  }
}

/**
 * Is this event type one the notification system should process?
 *
 * Fails OPEN (returns true) when the set cannot be resolved at all, so a
 * transient DB failure cannot silently skip an event. The async handler
 * re-checks against the matrix and no-ops if nothing is actually enabled.
 *
 * @param {string} eventType
 * @returns {Promise<boolean>}
 */
export async function isNotifiableEventType(eventType) {
  try {
    return (await getNotifiableEventTypes()).has(eventType)
  } catch (err) {
    console.warn(`[notifications] could not resolve notifiable event types, failing open: ${err.message}`)
    return true
  }
}

export default { getNotifiableEventTypes, isNotifiableEventType, invalidateEventTypeCache }
