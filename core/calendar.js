/**
 * core/calendar.js
 * Business calendar resolution and working time calculation.
 *
 * Key principle: ALL flow metrics store both wall clock seconds AND
 * working time seconds. This module computes the working time version.
 *
 * A request starting Monday 4:59pm and ending Tuesday 9:01am is either
 * 2 minutes or 16h 2min depending on the org's business calendar.
 *
 * Usage:
 *   import { resolveOrgCalendar, calculateWorkingTime } from '../core/calendar.js'
 *
 *   const calendar = await resolveOrgCalendar(orgId)
 *   const seconds  = await calculateWorkingTime(startTs, endTs, calendar)
 */

import { query } from '../db/postgres.js'

/**
 * Resolve the effective business calendar for an org.
 * Walks up the org tree until a calendar is found.
 * Returns null if no calendar defined (caller should treat as continuous/24-7).
 *
 * @param {number} orgId - PostgreSQL org ID
 * @returns {Promise<Object|null>} Calendar object with working hours and exceptions
 */
export async function resolveOrgCalendar(orgId) {
  // Walk up the org tree using a recursive CTE
  // Returns the first calendar found — closest ancestor wins
  const result = await query(`
    WITH RECURSIVE org_chain AS (
      -- Start at the target org
      SELECT id, parent_id, calendar_id, 0 AS depth
      FROM blueprint.organizations
      WHERE id = $1

      UNION ALL

      -- Walk up to parent
      SELECT o.id, o.parent_id, o.calendar_id, oc.depth + 1
      FROM blueprint.organizations o
      JOIN org_chain oc ON o.id = oc.parent_id
    )
    SELECT
      bc.*,
      org_chain.depth AS org_depth
    FROM org_chain
    JOIN blueprint.business_calendars bc ON bc.id = org_chain.calendar_id
    WHERE org_chain.calendar_id IS NOT NULL
      AND bc.is_active = true
    ORDER BY org_chain.depth ASC
    LIMIT 1
  `, [orgId])

  if (!result.rows.length) return null

  const calendar = result.rows[0]

  // Load working hours for this calendar
  const hoursResult = await query(`
    SELECT day_of_week, is_working_day, start_time, end_time
    FROM blueprint.calendar_working_hours
    WHERE calendar_id = $1
    ORDER BY day_of_week
  `, [calendar.id])

  // Load upcoming exceptions (next 2 years is sufficient)
  const exceptionsResult = await query(`
    SELECT exception_date, is_working_day, start_time, end_time, exception_name
    FROM blueprint.calendar_exceptions
    WHERE calendar_id = $1
      AND exception_date >= CURRENT_DATE
    ORDER BY exception_date
  `, [calendar.id])

  return {
    ...calendar,
    workingHours: hoursResult.rows,
    exceptions: exceptionsResult.rows,
  }
}

/**
 * Calculate working time in seconds between two timestamps.
 * Uses the org's business calendar to exclude non-working time.
 *
 * @param {Date|string} startTs - Start timestamp
 * @param {Date|string} endTs   - End timestamp
 * @param {Object|null} calendar - Calendar from resolveOrgCalendar(). If null, returns wall clock seconds.
 * @returns {number} Working time in seconds
 */
export function calculateWorkingTime(startTs, endTs, calendar) {
  const start = new Date(startTs)
  const end   = new Date(endTs)

  // No calendar or continuous org — return wall clock time
  if (!calendar || calendar.is_continuous) {
    return Math.round((end - start) / 1000)
  }

  // Build a lookup of working hours by day of week
  const hoursByDay = {}
  for (const h of (calendar.workingHours || [])) {
    hoursByDay[h.day_of_week] = h
  }

  // Build a lookup of exception dates
  const exceptionsByDate = {}
  for (const e of (calendar.exceptions || [])) {
    exceptionsByDate[e.exception_date] = e
  }

  // Get timezone offset for this calendar
  // We convert timestamps to the org's local time for day boundary calculations
  const tz = calendar.timezone || 'UTC'

  let workingSeconds = 0
  let cursor = new Date(start)

  // Walk minute by minute — simple and correct
  // For production, optimize with interval arithmetic
  // For MVP this handles all edge cases correctly
  while (cursor < end) {
    const next = new Date(cursor.getTime() + 60 * 1000) // advance 1 minute
    const minuteEnd = next < end ? next : end

    if (isWorkingTime(cursor, hoursByDay, exceptionsByDate, tz)) {
      workingSeconds += Math.round((minuteEnd - cursor) / 1000)
    }

    cursor = next
  }

  return workingSeconds
}

/**
 * Check if a given moment falls within working hours.
 *
 * @param {Date}   ts              - Timestamp to check
 * @param {Object} hoursByDay      - Working hours keyed by day_of_week (0-6)
 * @param {Object} exceptionsByDate - Exception dates keyed by YYYY-MM-DD
 * @param {string} tz              - IANA timezone string
 * @returns {boolean}
 */
function isWorkingTime(ts, hoursByDay, exceptionsByDate, tz) {
  // Convert to local time string for the org's timezone
  const localStr = ts.toLocaleString('en-CA', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })

  // Parse local date and time
  const [datePart, timePart] = localStr.split(', ')
  const dayOfWeek = new Date(ts.toLocaleString('en-US', { timeZone: tz })).getDay()
  const [hh, mm] = timePart.split(':').map(Number)
  const minuteOfDay = hh * 60 + mm

  // Check exception first — exceptions override weekly schedule
  const exceptionKey = datePart
  if (exceptionsByDate[exceptionKey]) {
    const ex = exceptionsByDate[exceptionKey]
    if (!ex.is_working_day) return false
    if (ex.start_time && ex.end_time) {
      const [exStartH, exStartM] = ex.start_time.split(':').map(Number)
      const [exEndH, exEndM]     = ex.end_time.split(':').map(Number)
      return minuteOfDay >= exStartH * 60 + exStartM
          && minuteOfDay <  exEndH   * 60 + exEndM
    }
    return true // exception is a working day with no specific hours = all day
  }

  // Fall back to weekly schedule
  const schedule = hoursByDay[dayOfWeek]
  if (!schedule || !schedule.is_working_day) return false
  if (!schedule.start_time || !schedule.end_time) return false

  const [startH, startM] = schedule.start_time.split(':').map(Number)
  const [endH,   endM]   = schedule.end_time.split(':').map(Number)

  return minuteOfDay >= startH * 60 + startM
      && minuteOfDay <  endH   * 60 + endM
}

/**
 * Wall clock time in seconds between two timestamps.
 * Convenience function for when working time isn't needed.
 *
 * @param {Date|string} startTs
 * @param {Date|string} endTs
 * @returns {number}
 */
export function wallClockSeconds(startTs, endTs) {
  return Math.round((new Date(endTs) - new Date(startTs)) / 1000)
}

/**
 * Format seconds into a human-readable duration string.
 * e.g. 3661 → "1h 1m"
 *
 * @param {number} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
  if (seconds < 60)   return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export default { resolveOrgCalendar, calculateWorkingTime, wallClockSeconds, formatDuration }
