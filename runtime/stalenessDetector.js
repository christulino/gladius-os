/**
 * runtime/stalenessDetector.js
 * Detects potentially stale context entries when a work item enters an active stage.
 *
 * When a work item transitions into an in-progress stage, this module checks:
 *   1. Context entries written during the most recent Planning (triage) stage
 *   2. Other work items in the same org that shipped (resolved) after those entries
 *   3. Keyword overlap between the planning entries and the shipped items
 *
 * If overlap is found, writes a `note` entry flagging the potentially stale entries.
 * Called as a fire-and-forget side effect — never throws, never blocks a transition.
 */

import { pool }             from '../db/postgres.js'
import { createContextEntry } from './contextEntries.js'

// Words too common to signal domain overlap.
const STOP_WORDS = new Set([
  'about', 'add', 'added', 'after', 'also', 'and', 'are', 'been', 'before',
  'both', 'but', 'can', 'could', 'during', 'each', 'from', 'had', 'has',
  'have', 'how', 'into', 'item', 'its', 'made', 'make', 'may', 'might',
  'more', 'must', 'new', 'not', 'only', 'our', 'over', 'should', 'stage',
  'such', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'they',
  'this', 'used', 'was', 'were', 'what', 'when', 'which', 'will', 'with',
  'work', 'would', 'your',
])

const MIN_KEYWORD_LEN = 4

/**
 * Extract meaningful keywords from text: lowercase alpha, min-length filtered,
 * stop-word removed.
 *
 * @param   {string}    text
 * @returns {Set<string>}
 */
export function extractKeywords(text) {
  if (!text) return new Set()
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= MIN_KEYWORD_LEN && !STOP_WORDS.has(w)),
  )
}

/**
 * Check if a shipped item's title+description overlaps with a keyword set.
 *
 * @param   {{ title: string|null, description: string|null }} item
 * @param   {Set<string>}                                      keywords
 * @returns {string[]}  matched keywords (may be empty)
 */
export function findOverlap(item, keywords) {
  const haystack = `${item.title ?? ''} ${item.description ?? ''}`.toLowerCase()
  return [...keywords].filter(kw => haystack.includes(kw))
}

/**
 * Run the staleness check for a work item that just entered an in-progress stage.
 * Writes a `note` entry when potentially stale planning context is found.
 *
 * @param {number} workItemId
 * @param {number} orgId
 * @returns {Promise<{ checked: boolean, staleCount: number }>}
 */
export async function checkContextStaleness(workItemId, orgId) {
  // 1. Find the most recent Planning (triage) stage window for this item.
  //    stage_transition_history rows record the stage being LEFT (from_stage_id),
  //    so a triage row gives us the exact window when the item lived in Planning.
  const planningResult = await pool.query(`
    SELECT sth.entered_from_stage_at AS planning_start,
           sth.exited_from_stage_at  AS planning_end
    FROM   runtime.stage_transition_history sth
    JOIN   blueprint.stages s ON s.id = sth.from_stage_id
    WHERE  sth.work_item_id = $1
      AND  s.stage_class    = 'triage'
    ORDER  BY sth.exited_from_stage_at DESC
    LIMIT  1
  `, [workItemId])

  if (!planningResult.rows.length) {
    return { checked: false, staleCount: 0 }
  }

  const { planning_start, planning_end } = planningResult.rows[0]

  // 2. Collect context entries written during that Planning window.
  const entriesResult = await pool.query(`
    SELECT id, type, title, content, created_at
    FROM   runtime.context_entries
    WHERE  work_item_id = $1
      AND  created_at  >= $2
      AND  created_at  <= $3
    ORDER  BY created_at ASC
  `, [workItemId, planning_start, planning_end])

  const planningEntries = entriesResult.rows
  if (!planningEntries.length) {
    return { checked: true, staleCount: 0 }
  }

  // 3. Find org work items that shipped after the earliest Planning entry was written
  //    and within the rolling 90-day lookback.
  const earliestEntry = planningEntries[0].created_at

  const shippedResult = await pool.query(`
    SELECT wi.id, wi.title, wi.description, wi.display_key, wi.resolved_at
    FROM   runtime.work_items wi
    WHERE  wi.owner_org_id = $1
      AND  wi.id           != $2
      AND  wi.spawn_state   = 'done'
      AND  wi.resolved_at  >= $3
      AND  wi.resolved_at  >= now() - INTERVAL '90 days'
    ORDER  BY wi.resolved_at DESC
    LIMIT  200
  `, [orgId, workItemId, earliestEntry])

  const shippedItems = shippedResult.rows
  if (!shippedItems.length) {
    return { checked: true, staleCount: 0 }
  }

  // 4. Extract keywords from all planning entries combined.
  const allPlanningText = planningEntries
    .map(e => `${e.title ?? ''} ${e.content}`)
    .join(' ')
  const keywords = extractKeywords(allPlanningText)

  if (!keywords.size) {
    return { checked: true, staleCount: 0 }
  }

  // 5. Find shipped items that overlap with planning keywords.
  const overlapping = []
  for (const item of shippedItems) {
    const matched = findOverlap(item, keywords)
    if (matched.length > 0) {
      overlapping.push({ ...item, matchedKeywords: matched })
    }
  }

  if (!overlapping.length) {
    return { checked: true, staleCount: 0 }
  }

  // 6. Write a staleness note entry summarising the findings.
  const entryList = planningEntries
    .map(e => `- **${e.type}**: ${e.title ?? '(untitled)'}`)
    .join('\n')

  const overlapList = overlapping
    .slice(0, 10)
    .map(i =>
      `- **${i.display_key}** — ${i.title} ` +
      `_(keywords: ${i.matchedKeywords.slice(0, 5).join(', ')})_`,
    )
    .join('\n')

  const moreNote = overlapping.length > 10
    ? `\n\n_...and ${overlapping.length - 10} more._`
    : ''

  const content = [
    `**${overlapping.length}** work item(s) shipped to this org since Planning was written ` +
    `that may overlap with this item's planning context. Review the entries below to confirm ` +
    `they still reflect current system behaviour.`,
    '',
    '### Planning entries that may be stale',
    entryList,
    '',
    '### Recently shipped overlapping items',
    overlapList + moreNote,
    '',
    `_Staleness check run at ${new Date().toISOString()}._`,
  ].join('\n')

  await createContextEntry(workItemId, {
    type:    'note',
    title:   `Staleness check: ${overlapping.length} potentially affected planning context item(s)`,
    content,
    isAgent: true,
    authorId: null,
  })

  return { checked: true, staleCount: overlapping.length }
}
