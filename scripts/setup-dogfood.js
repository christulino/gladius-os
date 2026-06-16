/**
 * scripts/setup-dogfood.js
 * One-shot setup for the FlowOS dogfood org (flowos-dev).
 * Idempotent — safe to run multiple times.
 *
 * Creates:
 *   - Dogfood org + Feature Development workflow + 8 stages + 12 transitions
 *   - Org WIP limit on Todo stage
 *   - 3 WIT types (Feature, Bug, Tech Debt)
 *   - Agent user (agent@flowos.internal)
 *   - 13 org context entries
 *   - Writes FLOWOS_AGENT_USER_ID + FLOWOS_API_KEY to .env
 *   - Merges mcpServers.flowos into .claude/settings.json
 */

import 'dotenv/config'
import { randomBytes } from 'crypto'
import { readFile, writeFile } from 'fs/promises'
import { getClient } from '../db/postgres.js'
import { generateUri, generateSystemUri } from '../core/uri.js'

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function upsertOne(client, sql, params, label) {
  const result = await client.query(sql, params)
  console.log(`  ✓ ${label}${result.rows[0] ? ` (id: ${result.rows[0].id})` : ''}`)
  return result.rows[0]
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function setup() {
  console.log('\n🐶 Setting up FlowOS dogfood org...\n')
  const client = await getClient()

  try {
    await client.query('BEGIN')

    // -----------------------------------------------------------------------
    // 1. System org lookup
    // -----------------------------------------------------------------------
    console.log('Step 1: System org lookup')
    const sysResult = await client.query(
      `SELECT id FROM blueprint.organizations WHERE slug = 'system'`
    )
    if (!sysResult.rows.length) {
      throw new Error('System org not found — run seed.js first')
    }
    const systemOrgId = sysResult.rows[0].id
    console.log(`  ✓ System org (id: ${systemOrgId})`)

    // -----------------------------------------------------------------------
    // 2. Dogfood org creation
    // -----------------------------------------------------------------------
    console.log('\nStep 2: Dogfood org')
    const dogfoodOrgUri = generateUri('flowos-dev', 'orgs')
    const dogfoodOrg = await upsertOne(
      client,
      `INSERT INTO blueprint.organizations (uri, slug, name, org_type, is_active)
       VALUES ($1, 'flowos-dev', 'FlowOS Development', 'team', true)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, slug`,
      [dogfoodOrgUri],
      'FlowOS Development org'
    )
    const dogfoodOrgId = dogfoodOrg.id

    // -----------------------------------------------------------------------
    // 3. Workflow
    // -----------------------------------------------------------------------
    console.log('\nStep 3: Feature Development workflow')
    let workflowId
    const existingWf = await client.query(
      `SELECT id FROM blueprint.workflows WHERE owner_org_id = $1 AND name = 'Feature Development'`,
      [dogfoodOrgId]
    )
    if (existingWf.rows.length) {
      workflowId = existingWf.rows[0].id
      console.log(`  ✓ Feature Development workflow (id: ${workflowId}) — already exists`)
    } else {
      const wfUri = generateUri('flowos-dev', 'workflows')
      const wfResult = await client.query(
        `INSERT INTO blueprint.workflows (uri, owner_org_id, name, description, version, is_system_default)
         VALUES ($1, $2, 'Feature Development', 'Software feature development workflow for the FlowOS project', '1.0.0', false)
         RETURNING id`,
        [wfUri, dogfoodOrgId]
      )
      workflowId = wfResult.rows[0].id
      console.log(`  ✓ Feature Development workflow created (id: ${workflowId})`)
    }

    // -----------------------------------------------------------------------
    // 4. Stages
    // -----------------------------------------------------------------------
    console.log('\nStep 4: Stages')
    const stageDefs = [
      { name: 'Backlog',    stage_class: 'intake',       stage_type: 'waiting', display_order: 1, is_entry_stage: true,  is_terminal: false, has_waiting_queue: false },
      { name: 'Todo',       stage_class: 'queued',       stage_type: 'waiting', display_order: 2, is_entry_stage: false, is_terminal: false, has_waiting_queue: false },
      { name: 'Discovery',  stage_class: 'in-progress',  stage_type: 'working', display_order: 3, is_entry_stage: false, is_terminal: false, has_waiting_queue: false },
      { name: 'Planning',   stage_class: 'in-progress',  stage_type: 'working', display_order: 4, is_entry_stage: false, is_terminal: false, has_waiting_queue: false },
      { name: 'Dev/Test',   stage_class: 'in-progress',  stage_type: 'working', display_order: 5, is_entry_stage: false, is_terminal: false, has_waiting_queue: true  },
      { name: 'Deployment', stage_class: 'delivery',     stage_type: 'working', display_order: 6, is_entry_stage: false, is_terminal: false, has_waiting_queue: false },
      { name: 'Review',     stage_class: 'review',       stage_type: 'working', display_order: 7, is_entry_stage: false, is_terminal: false, has_waiting_queue: false },
      { name: 'Done',       stage_class: 'done',         stage_type: 'waiting', display_order: 8, is_entry_stage: false, is_terminal: true,  has_waiting_queue: false },
    ]

    const stageIds = {}
    for (const s of stageDefs) {
      const existingStage = await client.query(
        `SELECT id FROM blueprint.stages WHERE workflow_id = $1 AND name = $2`,
        [workflowId, s.name]
      )
      if (existingStage.rows.length) {
        stageIds[s.name] = existingStage.rows[0].id
        console.log(`  ✓ Stage: ${s.name} (id: ${stageIds[s.name]}) — already exists`)
      } else {
        const stageUri = generateUri('flowos-dev', 'stages')
        const stageResult = await client.query(
          `INSERT INTO blueprint.stages
             (uri, workflow_id, name, stage_class, stage_type, display_order,
              is_entry_stage, is_terminal, has_waiting_queue)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [stageUri, workflowId, s.name, s.stage_class, s.stage_type,
           s.display_order, s.is_entry_stage, s.is_terminal, s.has_waiting_queue]
        )
        stageIds[s.name] = stageResult.rows[0].id
        console.log(`  ✓ Stage: ${s.name} (id: ${stageIds[s.name]})`)
      }
    }

    // -----------------------------------------------------------------------
    // 5. Org WIP limit for Todo
    // -----------------------------------------------------------------------
    console.log('\nStep 5: Org WIP limit (Todo = 8)')
    await upsertOne(
      client,
      `INSERT INTO blueprint.org_wip_limits (org_id, stage_name, wip_limit, enforcement_type)
       VALUES ($1, 'Todo', 8, 'soft')
       ON CONFLICT (org_id, stage_name) DO UPDATE SET wip_limit = EXCLUDED.wip_limit
       RETURNING id`,
      [dogfoodOrgId],
      'WIP limit Todo=8 (soft)'
    )

    // -----------------------------------------------------------------------
    // 6. Transitions
    // -----------------------------------------------------------------------
    console.log('\nStep 6: Transitions')
    const transitionDefs = [
      { from: 'Backlog',    to: 'Todo',       label: 'Add to Todo',           kind: 'forward'  },
      { from: 'Todo',       to: 'Discovery',  label: 'Start Discovery',        kind: 'forward'  },
      { from: 'Todo',       to: 'Planning',   label: 'Skip to Planning',       kind: 'forward'  },
      { from: 'Discovery',  to: 'Planning',   label: 'Start Planning',         kind: 'forward'  },
      { from: 'Planning',   to: 'Dev/Test',   label: 'Start Dev',              kind: 'forward'  },
      { from: 'Dev/Test',   to: 'Deployment', label: 'Deploy',                 kind: 'forward'  },
      { from: 'Deployment', to: 'Review',     label: 'Start Review',           kind: 'forward'  },
      { from: 'Deployment', to: 'Done',       label: 'Done (skip review)',     kind: 'forward'  },
      { from: 'Review',     to: 'Done',       label: 'Done',                   kind: 'forward'  },
      { from: 'Review',     to: 'Dev/Test',   label: 'Send back to Dev',       kind: 'backward' },
      { from: 'Discovery',  to: 'Todo',       label: 'Back to Todo',           kind: 'backward' },
      { from: 'Planning',   to: 'Discovery',  label: 'Back to Discovery',      kind: 'backward' },
    ]

    for (const t of transitionDefs) {
      const fromId = stageIds[t.from]
      const toId   = stageIds[t.to]
      await upsertOne(
        client,
        `INSERT INTO blueprint.stage_transitions
           (from_stage_id, to_stage_id, transition_label, transition_kind, requires_reason, is_active)
         VALUES ($1, $2, $3, $4, false, true)
         ON CONFLICT (from_stage_id, to_stage_id) DO UPDATE SET
           transition_label = EXCLUDED.transition_label,
           transition_kind  = EXCLUDED.transition_kind
         RETURNING id`,
        [fromId, toId, t.label, t.kind],
        `Transition: ${t.from} → ${t.to}`
      )
    }

    // -----------------------------------------------------------------------
    // 7. WIT Classes — look up Feature and Bug; create Tech Debt if missing
    // -----------------------------------------------------------------------
    console.log('\nStep 7: WIT Classes')

    const featureClassRow = await client.query(
      `SELECT id FROM blueprint.work_item_type_classes WHERE owner_org_id = $1 AND name = 'Feature'`,
      [systemOrgId]
    )
    if (!featureClassRow.rows.length) throw new Error('Feature class not found in system org')
    const featureClassId = featureClassRow.rows[0].id
    console.log(`  ✓ Feature class (id: ${featureClassId})`)

    const bugClassRow = await client.query(
      `SELECT id FROM blueprint.work_item_type_classes WHERE owner_org_id = $1 AND name = 'Bug'`,
      [systemOrgId]
    )
    if (!bugClassRow.rows.length) throw new Error('Bug class not found in system org')
    const bugClassId = bugClassRow.rows[0].id
    console.log(`  ✓ Bug class (id: ${bugClassId})`)

    // Tech Debt — create in system org if not present
    let techDebtClassId
    const tdExisting = await client.query(
      `SELECT id FROM blueprint.work_item_type_classes WHERE owner_org_id = $1 AND name = 'Tech Debt'`,
      [systemOrgId]
    )
    if (tdExisting.rows.length) {
      techDebtClassId = tdExisting.rows[0].id
      console.log(`  ✓ Tech Debt class (id: ${techDebtClassId}) — already exists`)
    } else {
      const tdUri = generateSystemUri('work-item-type-classes')
      const tdResult = await client.query(
        `INSERT INTO blueprint.work_item_type_classes
           (uri, owner_org_id, name, description, is_system_default)
         VALUES ($1, $2, 'Tech Debt', 'Technical debt and refactoring work', false)
         RETURNING id`,
        [tdUri, systemOrgId]
      )
      techDebtClassId = tdResult.rows[0].id
      console.log(`  ✓ Tech Debt class created (id: ${techDebtClassId})`)
    }

    // -----------------------------------------------------------------------
    // 8. WIT Types
    // -----------------------------------------------------------------------
    console.log('\nStep 8: WIT Types')
    const witDefs = [
      { name: 'Feature',   classId: featureClassId,   icon: '⭐', color: '#8B5CF6', key_prefix: 'FEAT' },
      { name: 'Bug',       classId: bugClassId,        icon: '🐛', color: '#EF4444', key_prefix: 'BUG'  },
      { name: 'Tech Debt', classId: techDebtClassId,   icon: '🔧', color: '#6B7280', key_prefix: 'DEBT' },
    ]

    const typeIds = {}
    for (const w of witDefs) {
      const existingWit = await client.query(
        `SELECT id FROM blueprint.work_item_types WHERE owner_org_id = $1 AND name = $2`,
        [dogfoodOrgId, w.name]
      )
      let witId
      if (existingWit.rows.length) {
        witId = existingWit.rows[0].id
        console.log(`  ✓ WIT Type: ${w.name} (id: ${witId}) — already exists`)
      } else {
        const witUri = generateUri('flowos-dev', 'work-item-types')
        const witResult = await client.query(
          `INSERT INTO blueprint.work_item_types
             (uri, owner_org_id, class_id, name, description, version,
              request_mode, is_published, is_system_default, icon, color, key_prefix)
           VALUES ($1, $2, $3, $4, $5, '1.0.0', 'user_requestable', true, false, $6, $7, $8)
           RETURNING id`,
          [witUri, dogfoodOrgId, w.classId, w.name,
           `${w.name} work item type for the FlowOS project`,
           w.icon, w.color, w.key_prefix]
        )
        witId = witResult.rows[0].id
        console.log(`  ✓ WIT Type: ${w.name} created (id: ${witId})`)
      }
      typeIds[w.name] = witId

      // Link to workflow
      await client.query(
        `INSERT INTO blueprint.work_item_type_workflows (work_item_type_id, workflow_id, is_current)
         VALUES ($1, $2, true)
         ON CONFLICT DO NOTHING`,
        [witId, workflowId]
      )
    }

    // -----------------------------------------------------------------------
    // 9. Agent user
    // -----------------------------------------------------------------------
    console.log('\nStep 9: Agent user')

    let agentId
    let apiKey
    const existingAgent = await client.query(
      `SELECT id, api_token FROM blueprint.users WHERE email = 'agent@flowos.internal'`
    )

    if (existingAgent.rows.length) {
      agentId = existingAgent.rows[0].id
      apiKey  = existingAgent.rows[0].api_token
      console.log(`  ✓ Agent user already exists (id: ${agentId})`)
    } else {
      apiKey = `fos_ak_${randomBytes(32).toString('hex')}`
      const agentUri = generateUri('flowos-dev', 'users')
      const agentResult = await client.query(
        `INSERT INTO blueprint.users
           (uri, email, display_name, is_active, is_agent, api_token)
         VALUES ($1, 'agent@flowos.internal', 'FlowOS Agent', true, true, $2)
         RETURNING id`,
        [agentUri, apiKey]
      )
      agentId = agentResult.rows[0].id
      console.log(`  ✓ Agent user created (id: ${agentId})`)
    }

    // Look up Admin role and add agent to dogfood org
    const adminRoleRow = await client.query(
      `SELECT id FROM blueprint.roles WHERE name = 'Admin' AND org_id = $1`,
      [systemOrgId]
    )
    if (adminRoleRow.rows.length) {
      const adminRoleId = adminRoleRow.rows[0].id
      await client.query(
        `INSERT INTO blueprint.org_memberships (user_id, org_id, role_id, is_active)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (user_id, org_id) DO NOTHING`,
        [agentId, dogfoodOrgId, adminRoleId]
      )
      console.log(`  ✓ Agent added to dogfood org (role: Admin)`)
    } else {
      console.warn(`  ⚠ Admin role not found in system org — skipping membership`)
    }

    // -----------------------------------------------------------------------
    // 10. Write to .env
    // -----------------------------------------------------------------------
    console.log('\nStep 10: Writing .env')
    const envPath = new URL('../.env', import.meta.url).pathname
    let envContent = ''
    try {
      envContent = await readFile(envPath, 'utf8')
    } catch {
      // .env doesn't exist yet — start fresh
    }

    // Remove existing FLOWOS_AGENT_USER_ID and FLOWOS_API_KEY lines
    envContent = envContent
      .split('\n')
      .filter(line => !line.startsWith('FLOWOS_AGENT_USER_ID=') && !line.startsWith('FLOWOS_API_KEY='))
      .join('\n')

    // Ensure trailing newline before appending
    if (envContent && !envContent.endsWith('\n')) {
      envContent += '\n'
    }
    envContent += `FLOWOS_AGENT_USER_ID=${agentId}\n`
    envContent += `FLOWOS_API_KEY=${apiKey}\n`

    await writeFile(envPath, envContent, 'utf8')
    console.log(`  ✓ .env updated with FLOWOS_AGENT_USER_ID=${agentId}`)

    // -----------------------------------------------------------------------
    // 11. Org context entries
    // -----------------------------------------------------------------------
    console.log('\nStep 11: Org context entries')
    const contextEntries = [
      {
        type: 'architecture',
        title: 'Two-schema discipline',
        content: 'PostgreSQL has two schemas: `blueprint` (structural definitions — orgs, workflows, stages, WIT types, fields) and `runtime` (work instances — work items, events, comments, context entries). Never mix them. Blueprint rows change rarely; runtime rows are high-volume append/update.',
      },
      {
        type: 'architecture',
        title: 'Transition engine — two-phase model',
        content: 'All work item stage transitions go through two phases. `prepare` evaluates exit criteria and returns a preview of what would change (does not commit). `execute` commits the transition, emits the event, and fires post-transition side effects (playbooks, notifications). Exit criteria GATE transitions. Playbooks and notification dispatches are SIDE EFFECTS — they never block the response.',
      },
      {
        type: 'architecture',
        title: 'Event system — append-only log',
        content: '`runtime.events` is an append-only event log. Emit events via `emitEvent(client, ...)` inside a transaction, then call `nudgeAfterCommit()` to wake the processor. The event processor holds a PG advisory lock — only one instance runs at a time. Subscribers in `runtime/subscribers/` are registered handlers. The search index, notifications, Neo4j sync, and audit trail all run as subscribers.',
      },
      {
        type: 'architecture',
        title: 'API request flow',
        content: 'Requests flow: `api/server.js` (middleware, route mounting) → route handler → domain module in `runtime/` or `admin/` → `db/postgres.js` (parameterized SQL via `pg` pool). No ORM. No string interpolation in SQL queries — ever. All user-supplied values go through parameterized query placeholders ($1, $2, ...).',
      },
      {
        type: 'architecture',
        title: 'MCP server — current limitation',
        content: 'The MCP server at `mcp/flowos-context-server.js` currently connects directly to PostgreSQL (imports `pool` from `db/postgres.js`). This is a known architectural gap. It should call the FlowOS REST API instead. The refactor is tracked as Feature FEAT.1 in this org. Until then, the MCP server requires direct DB access and can only run on a machine with database connectivity.',
      },
      {
        type: 'standard',
        title: 'ES modules everywhere',
        content: 'All JavaScript files use `import`/`export` syntax — never `require()`. The only exception is `tailwind.config.js` which uses CommonJS due to jiti compatibility. Node.js runtime is v24+. All files must be `.js` — no TypeScript.',
      },
      {
        type: 'standard',
        title: 'Parameterized SQL — no exceptions',
        content: 'Every database query uses parameterized placeholders ($1, $2, ...). No string interpolation, no template literals, no concatenation in SQL. This is non-negotiable — SQL injection is an automatic reject.',
      },
      {
        type: 'standard',
        title: 'React components — functional only, under 200 lines',
        content: 'All React components are functional (no class components). Component files must stay under 200 lines. When a component grows beyond that, extract sub-components into separate files. No `font-mono` class anywhere. Only `text-xs` (12px) and `text-sm` (14px) font sizes — no arbitrary pixel sizes.',
      },
      {
        type: 'standard',
        title: 'No modals — drawer only',
        content: 'The only overlay pattern in the UI is the right-side Sheet (drawer). No modals, no dialogs, no centered overlays. If a design requires an overlay, it is a drawer.',
      },
      {
        type: 'standard',
        title: 'Lint before done',
        content: 'Run `npx eslint .` from the project root before declaring any task complete. A task is not done if lint fails.',
      },
      {
        type: 'process',
        title: 'Pull, not push',
        content: 'Work is pulled downstream when capacity exists. Nothing is auto-advanced into a stage that has not signaled readiness. WIP limits enforce this. Violating this principle breaks the flow model.',
      },
      {
        type: 'process',
        title: 'WIP limits expose problems',
        content: 'WIP limits are diagnostic tools, not preventive ones. When a limit is hit, the correct response is to investigate the constraint — not to raise the limit or silently ignore it.',
      },
      {
        type: 'process',
        title: 'Just-in-time context',
        content: 'Discovery and Planning context entries have a useful life. If a Planning entry is written and the item sits in the backlog for weeks while other features ship, the design assumptions may be stale. Before starting Dev/Test on an item whose Planning entries are old, review them against recent changes.',
      },
    ]

    let contextSeeded = 0
    for (const entry of contextEntries) {
      const existing = await client.query(
        `SELECT id FROM blueprint.org_context WHERE org_id = $1 AND title = $2`,
        [dogfoodOrgId, entry.title]
      )
      if (existing.rows.length) {
        console.log(`  ↷ Skip (exists): ${entry.title}`)
        continue
      }
      await client.query(
        `INSERT INTO blueprint.org_context (org_id, type, title, content, author_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [dogfoodOrgId, entry.type, entry.title, entry.content, agentId]
      )
      console.log(`  ✓ Context entry: ${entry.title}`)
      contextSeeded++
    }
    console.log(`  → ${contextSeeded} entries seeded (${contextEntries.length - contextSeeded} already existed)`)

    // -----------------------------------------------------------------------
    // COMMIT
    // -----------------------------------------------------------------------
    await client.query('COMMIT')
    console.log('\n✅ Transaction committed.\n')

    // -----------------------------------------------------------------------
    // 12. MCP settings merge (outside transaction — file I/O)
    // -----------------------------------------------------------------------
    console.log('Step 12: Merging .claude/settings.json')
    const settingsPath = new URL('../.claude/settings.json', import.meta.url).pathname
    const mcpServerPath = new URL('../mcp/flowos-context-server.js', import.meta.url).pathname
    const databaseUrl = `postgresql://${process.env.POSTGRES_USER || 'flowos'}:${process.env.POSTGRES_PASSWORD || 'flowos_dev'}@${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || 5432}/${process.env.POSTGRES_DB || 'flowos'}`

    let settings = {}
    try {
      const raw = await readFile(settingsPath, 'utf8')
      settings = JSON.parse(raw)
    } catch {
      // File missing or invalid — start fresh
    }

    if (!settings.mcpServers) settings.mcpServers = {}
    settings.mcpServers.flowos = {
      command: 'node',
      args: [mcpServerPath],
      env: {
        DATABASE_URL: databaseUrl,
        FLOWOS_AGENT_USER_ID: String(agentId),
      },
    }

    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8')
    console.log(`  ✓ .claude/settings.json updated with mcpServers.flowos`)

    // -----------------------------------------------------------------------
    // 13. Summary
    // -----------------------------------------------------------------------
    console.log('\n' + '─'.repeat(60))
    console.log('SUMMARY')
    console.log('─'.repeat(60))
    console.log(`Org:          id=${dogfoodOrgId}  slug=flowos-dev`)
    console.log(`Workflow:     id=${workflowId}  name=Feature Development`)
    console.log('\nStages:')
    for (const [name, id] of Object.entries(stageIds)) {
      console.log(`  ${id.toString().padStart(4)}  ${name}`)
    }
    console.log('\nWIT Types:')
    for (const [name, id] of Object.entries(typeIds)) {
      console.log(`  ${id.toString().padStart(4)}  ${name}`)
    }
    console.log(`\nAgent User:   id=${agentId}  email=agent@flowos.internal`)
    console.log(`API Key:      ${apiKey.slice(0, 20)}...`)
    console.log('─'.repeat(60))
    console.log()

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('\n❌ Setup failed — rolled back.\n', err)
    process.exit(1)
  } finally {
    client.release()
  }
}

setup()
