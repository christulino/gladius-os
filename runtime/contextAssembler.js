/**
 * runtime/contextAssembler.js
 * Assembles context for an AI agent before it runs a playbook.
 *
 * Reads playbook frontmatter meta to know what to pull:
 *   meta.context.pull  — array of entry types to pull from the item's journal (+ optional ancestors)
 *   meta.context.org   — array of org context types to inject
 */

import { pool }           from '../db/postgres.js'
import { listOrgContext } from './orgContext.js'

/**
 * Character budget for the assembled context block.
 *
 * Caps the total text sent to the LLM so a large journal or org-context library
 * cannot silently bloat a prompt beyond what the model handles well.  The limit
 * is applied in formatContextForPrompt after all sections are rendered; material
 * is truncated at the limit with a clearly labelled notice.
 *
 * ~24 000 chars ≈ 6 000 tokens — generous for context, well inside any Claude window.
 */
export const MAX_CONTEXT_CHARS = 24_000

/**
 * Pull context for a work item based on playbook meta.
 *
 * @param {number} workItemId
 * @param {number} orgId
 * @param {Object} meta   - parsed playbook frontmatter
 * @returns {Promise<{itemJournal: Object[], ancestors: Object[], orgContext: Object[]}>}
 */
export async function assembleContext(workItemId, orgId, meta) {
  const ctx = { itemJournal: [], ancestors: [], orgContext: [] }

  const pullTypes = meta?.context?.pull ?? []

  // Pull item journal entries by type (exclude the special 'ancestors' sentinel).
  // Include is_agent so formatContextForPrompt can apply provenance fencing.
  const itemTypes = pullTypes.filter(t => t !== 'ancestors')
  if (itemTypes.length) {
    const rows = await pool.query(`
      SELECT type, title, content, created_at, is_agent
      FROM runtime.context_entries
      WHERE work_item_id = $1 AND type = ANY($2::text[])
      ORDER BY created_at DESC
    `, [workItemId, itemTypes])
    ctx.itemJournal = rows.rows
  }

  // Pull ancestor journal entries if 'ancestors' is in pull.
  // Include is_agent for consistent provenance tagging.
  if (pullTypes.includes('ancestors')) {
    const rows = await pool.query(`
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id FROM runtime.work_items WHERE id = $1
        UNION ALL
        SELECT wi.id, wi.parent_id FROM runtime.work_items wi
        JOIN ancestors a ON wi.id = a.parent_id
      )
      SELECT ce.type, ce.title, ce.content, ce.created_at, ce.is_agent, a.id AS work_item_id
      FROM ancestors a
      JOIN runtime.context_entries ce ON ce.work_item_id = a.id
      WHERE a.id != $1
      ORDER BY ce.created_at DESC
      LIMIT 50
    `, [workItemId])
    ctx.ancestors = rows.rows
  }

  // Inject org context
  const orgTypes = meta?.context?.org ?? []
  if (orgTypes.length) {
    ctx.orgContext = await listOrgContext(orgId, { types: orgTypes })
  }

  return ctx
}

/**
 * Format assembled context into a text block suitable for an AI system prompt.
 *
 * Each item-journal and ancestor entry is tagged with [human] or [agent] so the
 * LLM can distinguish authoritative human input from prior agent-generated output
 * (which may contain hallucinations and should not be treated as ground truth).
 *
 * The total output is capped at `budgetChars` (defaults to MAX_CONTEXT_CHARS);
 * any material beyond the budget is replaced with a truncation notice. Pass an
 * explicit `budgetChars` to honor a playbook's `context_budget` frontmatter key.
 *
 * @param {Object} ctx - result from assembleContext()
 * @param {number} [budgetChars] - character budget override; defaults to MAX_CONTEXT_CHARS
 * @returns {string}
 */
export function formatContextForPrompt(ctx, budgetChars = MAX_CONTEXT_CHARS) {
  const parts = []

  if (ctx.orgContext?.length) {
    // Org context is always human-curated; no per-entry provenance tag needed.
    parts.push('## Org Context\n' + ctx.orgContext.map(e =>
      `### ${e.type}: ${e.title}\n${e.content}`
    ).join('\n\n'))
  }

  if (ctx.ancestors?.length) {
    parts.push('## Ancestor Context\n' + ctx.ancestors.map(e => {
      const provenance = e.is_agent ? '[agent]' : '[human]'
      return `${provenance} [${e.type}] ${e.title || ''}: ${e.content}`
    }).join('\n'))
  }

  if (ctx.itemJournal?.length) {
    parts.push('## Item Journal\n' + ctx.itemJournal.map(e => {
      const provenance = e.is_agent ? '[agent]' : '[human]'
      return `${provenance} [${e.type}] ${e.title || ''}: ${e.content}`
    }).join('\n'))
  }

  const full = parts.join('\n\n')
  if (full.length <= budgetChars) return full

  // Budget exceeded — truncate and append a visible notice so the prompt
  // reader (human or LLM) can see that material was dropped.
  return full.slice(0, budgetChars) + '\n\n_[context truncated to budget]_'
}
