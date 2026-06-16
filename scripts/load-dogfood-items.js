/**
 * scripts/load-dogfood-items.js
 * Loads initial work items into the FlowOS dogfood org.
 * Idempotent — skips items whose title already exists in the org.
 * Run: node scripts/load-dogfood-items.js
 *
 * Prerequisite: run scripts/setup-dogfood.js first.
 */

import 'dotenv/config'
import { getClient } from '../db/postgres.js'
import { generateUri } from '../core/uri.js'

async function loadItems() {
  console.log('\n📋 Loading dogfood work items\n')
  const client = await getClient()

  try {
    await client.query('BEGIN')

    // ── Resolve org, types, stages ─────────────────────────────────────────
    const orgRow = await client.query(
      "SELECT id FROM blueprint.organizations WHERE slug = 'flowos-dev'"
    )
    if (!orgRow.rows.length) throw new Error('flowos-dev org not found. Run setup-dogfood.js first.')
    const orgId = orgRow.rows[0].id

    const typeRows = await client.query(
      'SELECT id, name FROM blueprint.work_item_types WHERE owner_org_id = $1', [orgId]
    )
    const typeIds = {}
    for (const r of typeRows.rows) typeIds[r.name] = r.id

    const wfRow = await client.query(
      "SELECT id FROM blueprint.workflows WHERE owner_org_id = $1 AND name = 'Feature Development'",
      [orgId]
    )
    if (!wfRow.rows.length) throw new Error('Feature Development workflow not found.')
    const wfId = wfRow.rows[0].id

    const stageRows = await client.query(
      'SELECT id, name FROM blueprint.stages WHERE workflow_id = $1 AND is_active = true', [wfId]
    )
    const stageByName = {}
    for (const r of stageRows.rows) stageByName[r.name] = r.id

    const scRow = await client.query(
      "SELECT id FROM blueprint.service_classes WHERE name = 'Standard' LIMIT 1"
    )
    const serviceClassId = scRow.rows[0]?.id

    // ── Work items ─────────────────────────────────────────────────────────
    const items = [
      // Priority 1 — immediate
      { title: 'MCP Server → REST API refactor',     type: 'Feature',   priority: 1, stage: 'Todo',
        description: 'Refactor mcp/flowos-context-server.js to call the FlowOS REST API via HTTP (authenticated with a fos_ak_ API key) instead of connecting directly to PostgreSQL. Eliminates the direct-DB coupling, making the MCP server portable to any FlowOS instance.' },

      // Priority 2 — next up
      { title: 'Context staleness detection',         type: 'Feature',   priority: 2, stage: 'Backlog',
        description: 'When a work item enters Dev/Test, check the age of its Planning-stage context entries against the shipped dates of other work items. If items have shipped since Planning was written that touch overlapping domains, flag the entries as potentially stale.' },
      { title: 'Async deployment feedback loop',      type: 'Feature',   priority: 2, stage: 'Backlog',
        description: 'Add a webhook receiver so external CI/CD tools (Sonar, vulnerability scanners, deployment pipelines) can post results back to FlowOS as context entries on the relevant work item. Enables Deployment-stage playbooks to react to real build outcomes rather than just generating a static checklist.' },
      { title: 'Solution RAG',                        type: 'Feature',   priority: 2, stage: 'Backlog',
        description: 'Build a vector index (pgvector) over the codebase, org context library, and work item journals for items in Planning or later. Add a context.rag playbook frontmatter option so playbooks can run a semantic retrieval query instead of grepping the full codebase.' },
      { title: 'Bulk ops integration tests',          type: 'Tech Debt', priority: 2, stage: 'Backlog',
        description: 'Write tests/bulk-ops.test.js covering: happy path bulk transition (all succeed), partial-success bulk transition (some items have unmet exit criteria), happy path bulk assign, and invalid input validation.' },
      { title: 'Stage-evidence requirements',         type: 'Feature',   priority: 2, stage: 'Backlog',
        description: 'Allow workflow designers to define named attachment slots per stage (e.g. "Permit to Operate", "Design Review Sign-off") that gate transitions. Items cannot leave the stage until all required attachment slots are filled.' },
      { title: 'Open-source release prep',            type: 'Feature',   priority: 2, stage: 'Backlog',
        description: 'README, LICENSE (MIT), and a seed-and-go experience: docker compose up → npm run seed → working board with realistic data and a pre-created admin user. No manual configuration steps.' },
      { title: 'SLA tracking and alerts',             type: 'Feature',   priority: 2, stage: 'Backlog',
        description: 'sla_hours exists on blueprint.service_classes. Add per-item SLA countdown display on work item cards and in the detail drawer. Emit sla.breach events when items exceed their SLA. Hook into the notification system for breach alerts.' },
      { title: 'Markdown in descriptions and comments', type: 'Feature', priority: 2, stage: 'Backlog',
        description: 'Render work item descriptions and comments as Markdown (using a lightweight renderer like marked or remark). Store as plain Markdown text; render on display. Preserve existing plain-text content.' },
      { title: 'Dashboard / landing page',            type: 'Feature',   priority: 2, stage: 'Backlog',
        description: 'Replace the current summary page with a real configurable dashboard. Initial widget set: items in progress by type, WIP by stage, throughput (last 7d/30d), items aging past SLA, and a personal My Items view.' },
      { title: 'Apply skills to work items',          type: 'Feature',   priority: 2, stage: 'Backlog',
        description: 'Add an on-demand agent skill palette to work items. A user selects a named skill (architecture review, BDD, UX design, Gherkin, code review, root cause analysis, reproduce bug, etc.) and invokes it against the current work item. The agent executes with full context and surfaces output interactively. The user can respond and the agent can act via MCP (write context entries, transition, comment). Distinct from playbooks: skills are manual and interactive, playbooks are automated and stage-triggered.' },
      { title: 'Cross-org flow visibility (Network Board)', type: 'Feature', priority: 2, stage: 'Backlog',
        description: 'A Network Board view showing work flowing between connected FlowOS orgs. Requires cross-instance service request protocol. Neither Jira nor ServiceNow shows inter-team flow well — this is the key differentiator.' },
      { title: 'Blocking chain analysis',             type: 'Feature',   priority: 2, stage: 'Backlog',
        description: 'Using Neo4j (already in the stack but not yet seeded for graph queries), answer "what is this item blocking, and what is blocking it?" across the full work graph. Visualize blocking chains from the work item detail view.' },

      // Priority 3 — low
      { title: 'Email-to-ticket',                     type: 'Feature',   priority: 3, stage: 'Backlog',
        description: 'Inbound email parsing that creates work items automatically. Requires an email intake adapter (IMAP polling or webhook from an email provider), a mapping layer to WIT types, and a way to handle replies as comments.' },
      { title: 'Keyboard shortcuts',                   type: 'Feature',   priority: 3, stage: 'Backlog',
        description: 'Board and work-item power-user keyboard shortcuts. Minimum: j/k navigation on board, Enter to open item, Escape to close, T to transition, A to assign.' },
    ]

    let created = 0
    let skipped = 0

    for (const item of items) {
      const typeId = typeIds[item.type]
      if (!typeId) {
        console.warn(`  ⚠ Skipping "${item.title}": type "${item.type}" not found`)
        skipped++
        continue
      }

      // Idempotency: skip if title already exists in this org
      const exists = await client.query(
        'SELECT id FROM runtime.work_items WHERE owner_org_id = $1 AND title = $2',
        [orgId, item.title]
      )
      if (exists.rows.length) {
        skipped++
        continue
      }

      // Resolve target stage
      const targetStageName = item.stage || 'Backlog'
      const stageId = stageByName[targetStageName] || stageByName['Backlog']

      // Display key
      const prefixRow = await client.query(
        'SELECT key_prefix FROM blueprint.work_item_types WHERE id = $1', [typeId]
      )
      const keyPrefix = prefixRow.rows[0]?.key_prefix
      let displayKey = null
      let seqNum = null
      if (keyPrefix) {
        const seqResult = await client.query("SELECT nextval('runtime.work_item_seq') AS seq")
        seqNum = parseInt(seqResult.rows[0].seq)
        displayKey = `${keyPrefix}.${seqNum}`
      }

      const itemUri = generateUri('flowos-dev', 'work-items')
      await client.query(`
        INSERT INTO runtime.work_items (
          uri, work_item_type_id, owner_org_id,
          workflow_id, current_stage_id, current_substate,
          service_class_id, spawn_state,
          title, description, priority,
          sequence_number, display_key,
          origin, entered_current_stage_at, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,'active',$6,'active',$7,$8,$9,$10,$11,'manual',NOW(),NOW(),NOW())
      `, [
        itemUri, typeId, orgId, wfId, stageId,
        serviceClassId, item.title, item.description || null, item.priority,
        seqNum, displayKey,
      ])
      console.log(`  ✓ ${displayKey} — ${item.title}`)
      created++
    }

    await client.query('COMMIT')
    console.log(`\n✅ Done. ${created} items created, ${skipped} skipped.\n`)

  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\n❌ Load failed — rolled back.\n', err)
    process.exit(1)
  } finally {
    client.release()
    process.exit(0)
  }
}

loadItems()
