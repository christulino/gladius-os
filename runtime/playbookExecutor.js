/**
 * runtime/playbookExecutor.js
 * Executes a stage playbook for a work item after a successful transition.
 *
 * Called as a fire-and-forget side effect — never throws, never blocks the
 * transition response. All errors are logged and swallowed.
 */

import Anthropic                         from '@anthropic-ai/sdk'

// ── Retry helper ─────────────────────────────────────────────────────────────

const MAX_RETRY_ATTEMPTS = 3   // max total attempts (1 initial + 2 retries)
const BASE_RETRY_DELAY_MS = 1_000

/**
 * Wrap an async API call with exponential backoff for transient errors.
 *
 * Only 429 (rate-limit) and 529 (overload) are retried; any other status is
 * a hard failure and is re-thrown immediately.
 *
 * @param {() => Promise<any>} fn
 * @returns {Promise<any>}
 */
import { getPlaybookForStage, parsePlaybook, isValidContextBudget } from './stagePlaybooks.js'
import { resolveModelConfig }            from './orgAiModels.js'
import { assembleContext, formatContextForPrompt } from './contextAssembler.js'
import { createContextEntry }            from './contextEntries.js'
import { parseAgentEntries }             from './parseAgentEntries.js'
import { pool }                          from '../db/postgres.js'

async function callWithRetry(fn) {
  let attempt = 0
  while (true) {
    try {
      return await fn()
    } catch (err) {
      const status = err.status ?? err.statusCode
      const isRetryable = status === 429 || status === 529
      attempt++
      if (!isRetryable || attempt >= MAX_RETRY_ATTEMPTS) throw err
      const delay = BASE_RETRY_DELAY_MS * (2 ** (attempt - 1)) // 1 s, 2 s
      console.warn(
        `[playbookExecutor] HTTP ${status} — retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRY_ATTEMPTS})`,
      )
      await new Promise(r => setTimeout(r, delay))
    }
  }
}

async function insertRunRecord(workItemId, stageId, playbookId) {
  const result = await pool.query(
    `INSERT INTO runtime.playbook_runs (work_item_id, stage_id, playbook_id, status)
     VALUES ($1, $2, $3, 'running') RETURNING id`,
    [workItemId, stageId, playbookId ?? null]
  )
  return result.rows[0].id
}

async function updateRunRecord(runId, fields) {
  const { status, model, inputTokens, outputTokens, stopReason, entriesWritten, errorMessage } = fields
  await pool.query(
    `UPDATE runtime.playbook_runs SET
       status          = $2,
       model           = $3,
       input_tokens    = $4,
       output_tokens   = $5,
       stop_reason     = $6,
       entries_written = $7,
       error_message   = $8,
       completed_at    = now()
     WHERE id = $1`,
    [runId, status, model ?? null, inputTokens ?? null, outputTokens ?? null,
     stopReason ?? null, entriesWritten ?? null, errorMessage ?? null]
  )
}

/**
 * Run the playbook for a stage entry, if one exists and is active.
 *
 * @param {number}      workItemId
 * @param {number}      stageId
 * @param {number}      orgId
 * @param {number|null} witTypeId
 */
export async function executePlaybookForStageEntry(workItemId, stageId, orgId, witTypeId = null) {
  let runId = null

  try {
    // 1. Find the most specific active playbook for this stage + type
    const playbook = await getPlaybookForStage(stageId, witTypeId)
    if (!playbook || !playbook.is_active) return
    if (playbook.execution_owner === 'agent') {
      console.log(`[playbookExecutor] stage ${stageId}: execution_owner=agent, skipping in-server execution`)
      return
    }

    const { meta, body } = parsePlaybook(playbook.content)

    // Only run on stage entry (default trigger)
    const trigger = meta?.trigger ?? 'on_enter'
    if (trigger !== 'on_enter' && trigger !== 'stage_entry') return

    // Insert run record early so every execution path (including config errors)
    // is visible in the UI via PlaybookRunIndicator.
    runId = await insertRunRecord(workItemId, stageId, playbook.id)

    // 2. Resolve AI model config (includes decrypted API key)
    const modelName = meta?.model ?? 'default'
    const config = await resolveModelConfig(orgId, modelName)
    if (!config || !config.apiKey) {
      const errMsg = `No AI model named "${modelName}" is configured for this org. ` +
        `Add a model with that name in Org Center → AI Models.`
      console.warn(`[playbookExecutor] ${errMsg} (org ${orgId}, stage ${stageId})`)
      await updateRunRecord(runId, { status: 'failed', errorMessage: errMsg })
      return
    }

    // 3. Assemble context from item journal, ancestors, and org context.
    // Honor a per-playbook `context_budget` frontmatter override if present
    // and valid; otherwise formatContextForPrompt falls back to the global
    // default (MAX_CONTEXT_CHARS). Save-time validation (admin/api.js) should
    // already guarantee a stored value is valid, but this stays defensive
    // since this path must never throw.
    const ctx = await assembleContext(workItemId, orgId, meta)
    const contextBudget = isValidContextBudget(meta?.context_budget) ? meta.context_budget : undefined
    const contextBlock = formatContextForPrompt(ctx, contextBudget)

    // 4. Fetch work item summary fields for the prompt
    const wiRow = await pool.query(
      `SELECT title, description, display_key FROM runtime.work_items WHERE id = $1`,
      [workItemId]
    )
    const wi = wiRow.rows[0]
    if (!wi) {
      await updateRunRecord(runId, { status: 'failed', errorMessage: 'Work item not found' })
      return
    }

    // 5. Build system and user prompts
    const allowedWriteTypes = meta?.context?.write ?? ['note']
    const systemPrompt = [
      'You are an AI agent helping manage a work item in a Kanban workflow system.',
      'You will be given context about the work item and instructions from the stage playbook.',
      'Your output will be saved as context entries on the work item.',
      '',
      contextBlock ? `Context:\n${contextBlock}\n` : '',
      'Respond with a JSON array of context entries to write. Each entry must have the shape:',
      '{ "type": "<type>", "title": "<title>", "content": "<markdown content>" }',
      '',
      `Allowed write types: ${allowedWriteTypes.join(', ')}`,
      'Only write entries of the allowed types.',
    ].filter(l => l !== undefined).join('\n')

    const userPrompt = [
      `Work item: ${wi.display_key} — ${wi.title}`,
      wi.description ? `Description: ${wi.description}` : '',
      '',
      'Stage playbook instructions:',
      body,
    ].filter(Boolean).join('\n')

    // 6. Call the AI model — retries on 429/529 with exponential backoff.
    const maxTokens = meta?.max_tokens ?? 4096
    const client = new Anthropic({ apiKey: config.apiKey })
    const response = await callWithRetry(() => client.messages.create(
      {
        model:      config.model,
        max_tokens: maxTokens,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userPrompt }],
      },
      { timeout: 90_000 },
    ))

    // Collect text from ALL content blocks — the API may return more than one.
    const rawText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')

    const inputTokens  = response.usage?.input_tokens  ?? null
    const outputTokens = response.usage?.output_tokens ?? null
    const stopReason   = response.stop_reason           ?? null
    const resolvedModel = config.model

    // Warn when the model hit its token ceiling — even if the parser salvages
    // output, the response is structurally incomplete and max_tokens may need
    // raising in the playbook frontmatter.
    if (stopReason === 'max_tokens') {
      console.warn(
        `[playbookExecutor] Response stopped at max_tokens for work item ${workItemId} (stage ${stageId}). ` +
        `Consider raising max_tokens in the playbook frontmatter (current: ${maxTokens}).`,
      )
    }

    // 7. Parse the response into entries — tolerant of code fences and of
    //    truncation (a token-limited array is salvaged object-by-object). The
    //    raw blob is NEVER stored as a pretend entry.
    const { entries, truncated } = parseAgentEntries(rawText)
    if (truncated) {
      console.warn(`[playbookExecutor] Imperfect/truncated output for work item ${workItemId} (stage ${stageId}); salvaged ${entries.length}. Consider raising the playbook max_tokens.`)
    }

    // 8. Validate against the write allowlist and persist each entry
    const allowedTypes = new Set(allowedWriteTypes)
    let written = 0
    for (const entry of entries) {
      if (!allowedTypes.has(entry.type)) continue
      if (!entry.content) continue
      await createContextEntry(workItemId, {
        type:     entry.type,
        title:    entry.title || null,
        content:  entry.content,
        isAgent:  true,
        authorId: null,
      })
      written++
    }

    await updateRunRecord(runId, {
      status:         'success',
      model:          resolvedModel,
      inputTokens,
      outputTokens,
      stopReason,
      entriesWritten: written,
    })

    console.log(`[playbookExecutor] Wrote ${written} entries for work item ${workItemId} (stage ${stageId})`)
  } catch (err) {
    // Never throw — this is a non-fatal side effect
    console.error(`[playbookExecutor] Error for work item ${workItemId}:`, err.message)
    if (runId) {
      await updateRunRecord(runId, { status: 'failed', errorMessage: err.message }).catch(() => {})
    }
  }
}
