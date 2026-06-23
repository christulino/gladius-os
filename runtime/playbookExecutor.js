/**
 * runtime/playbookExecutor.js
 * Executes a stage playbook for a work item after a successful transition.
 *
 * Called as a fire-and-forget side effect — never throws, never blocks the
 * transition response. All errors are logged and swallowed.
 */

import Anthropic                         from '@anthropic-ai/sdk'
import { getPlaybookForStage, parsePlaybook } from './stagePlaybooks.js'
import { resolveModelConfig }            from './orgAiModels.js'
import { assembleContext, formatContextForPrompt } from './contextAssembler.js'
import { createContextEntry }            from './contextEntries.js'
import { parseAgentEntries }             from './parseAgentEntries.js'
import { pool }                          from '../db/postgres.js'

/**
 * Run the playbook for a stage entry, if one exists and is active.
 *
 * @param {number}      workItemId
 * @param {number}      stageId
 * @param {number}      orgId
 * @param {number|null} witTypeId
 */
export async function executePlaybookForStageEntry(workItemId, stageId, orgId, witTypeId = null) {
  try {
    // 1. Find the most specific active playbook for this stage + type
    const playbook = await getPlaybookForStage(stageId, witTypeId)
    if (!playbook || !playbook.is_active) return

    const { meta, body } = parsePlaybook(playbook.content)

    // Only run on stage entry (default trigger)
    const trigger = meta?.trigger ?? 'on_enter'
    if (trigger !== 'on_enter' && trigger !== 'stage_entry') return

    // 2. Resolve AI model config (includes decrypted API key)
    const modelName = meta?.model ?? 'default'
    const config = await resolveModelConfig(orgId, modelName)
    if (!config || !config.apiKey) {
      console.warn(`[playbookExecutor] No AI model "${modelName}" configured for org ${orgId}`)
      return
    }

    // 3. Assemble context from item journal, ancestors, and org context
    const ctx = await assembleContext(workItemId, orgId, meta)
    const contextBlock = formatContextForPrompt(ctx)

    // 4. Fetch work item summary fields for the prompt
    const wiRow = await pool.query(
      `SELECT title, description, display_key FROM runtime.work_items WHERE id = $1`,
      [workItemId]
    )
    const wi = wiRow.rows[0]
    if (!wi) return

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

    // 6. Call the AI model
    const maxTokens = meta?.max_tokens ?? 4096
    const client = new Anthropic({ apiKey: config.apiKey })
    const response = await client.messages.create(
      {
        model:      config.model,
        max_tokens: maxTokens,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userPrompt }],
      },
      { timeout: 90_000 }
    )

    const rawText = response.content[0]?.text ?? ''

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

    // If nothing parsed, record a clean diagnostic note — never the raw JSON.
    if (written === 0) {
      await createContextEntry(workItemId, {
        type:     'note',
        title:    'Playbook produced no usable output',
        content:  "The stage playbook ran but its output could not be parsed into entries (empty or malformed model output). The raw output was discarded. If this recurs, check the playbook's max_tokens and model.",
        isAgent:  true,
        authorId: null,
      })
    }

    console.log(`[playbookExecutor] Wrote ${written} entries for work item ${workItemId} (stage ${stageId})`)
  } catch (err) {
    // Never throw — this is a non-fatal side effect
    console.error(`[playbookExecutor] Error for work item ${workItemId}:`, err.message)
  }
}
