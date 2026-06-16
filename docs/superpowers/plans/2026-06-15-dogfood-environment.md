# FlowOS Dogfood Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a persistent local FlowOS instance with a "FlowOS Development" org, 8-stage workflow, 3 WIT types, an agent user, seeded org context, MCP registration, and 16 initial work items.

**Architecture:** Two scripts (`setup-dogfood.js` and `load-dogfood-items.js`) run once against the live database using the same direct-SQL + `getClient()` pattern as `db/seeds/seed.js`. PM2 manages the Node.js API server for persistence. The MCP server is registered in `.claude/settings.json` so Claude has live database access in every session.

**Tech Stack:** Node.js ESM, `pg` pool (`db/postgres.js`), `crypto` (built-in), `fs/promises` (built-in), PM2 (global npm install)

---

## Pre-flight Check

Before starting, verify the database is running and migrated:

```bash
docker compose ps              # postgres should be "running (healthy)"
curl -s http://localhost:3000/auth/status | node -e "process.stdin|>require('fs').createReadStream|>JSON.stringify" 2>/dev/null || echo "server not running — that is fine"
```

The server does NOT need to be running for Tasks 1–8. It must be running for Task 11 (load work items).

---

## Task 1: Configure Docker Desktop Auto-Start

**Files:** None (system setting)

- [ ] **Step 1: Enable Docker Desktop start on login**

  Open Docker Desktop → Settings (gear icon, top right) → General → check "Start Docker Desktop when you log in to your Mac" → Apply & Restart.

- [ ] **Step 2: Verify containers come up**

```bash
docker compose up -d
docker compose ps
```

Expected: three services (`flowos-postgres`, `flowos-neo4j`, `flowos-minio`) all showing `running (healthy)` or `running`.

- [ ] **Step 3: Commit nothing** — this is a system configuration change, no files changed.

---

## Task 2: Install PM2 and Configure the API Server

**Files:** None (global install + PM2 ecosystem config)

- [ ] **Step 1: Install PM2 globally**

```bash
npm install -g pm2
pm2 --version   # should print a version number like 5.x.x
```

- [ ] **Step 2: Start the API server under PM2**

Run from the project root (`/Users/chris/Documents/ai/flowos`):

```bash
pm2 start npm --name flowos-api -- start
pm2 status
```

Expected: `flowos-api` listed with status `online`.

- [ ] **Step 3: Verify the API responds**

```bash
curl -s http://localhost:3000/auth/status
```

Expected: `{"needsSetup":false,"authenticated":false,"user":null}` (or similar — the exact shape depends on whether setup has been run).

- [ ] **Step 4: Register PM2 with macOS launchd so it survives reboots**

```bash
pm2 save
pm2 startup
```

`pm2 startup` prints a `sudo env PATH=...` command. **Copy and run that exact command.** It installs a launchd plist so PM2 restarts on login.

- [ ] **Step 5: Build the admin UI for static serving**

```bash
cd admin-ui && npm run build && cd ..
```

Expected: `admin-ui/dist/` populated. Verify:

```bash
ls admin-ui/dist/
```

Should contain `index.html` and `assets/`.

- [ ] **Step 6: Verify the board loads in a browser**

Open `http://localhost:3000/admin/` in a browser. You should see the FlowOS login or board UI (not a blank page or 404).

---

## Task 3: Scaffold `scripts/setup-dogfood.js`

**Files:**
- Create: `scripts/setup-dogfood.js`

- [ ] **Step 1: Create the file with imports and idempotency helper**

```js
/**
 * scripts/setup-dogfood.js
 * One-time setup for the FlowOS dogfood org.
 * Idempotent — safe to run multiple times.
 * Run: node scripts/setup-dogfood.js
 */

import 'dotenv/config'
import { randomBytes } from 'crypto'
import { readFile, writeFile } from 'fs/promises'
import { getClient }           from '../db/postgres.js'
import { generateUri, generateSystemUri } from '../core/uri.js'

async function upsertOne(client, sql, params, label) {
  const result = await client.query(sql, params)
  console.log(`  ✓ ${label}${result.rows[0] ? ` (id: ${result.rows[0].id})` : ''}`)
  return result.rows[0]
}

async function setup() {
  console.log('\n🐾 FlowOS Dogfood Setup\n')
  const client = await getClient()

  try {
    await client.query('BEGIN')

    // steps go here

    await client.query('COMMIT')
    console.log('\n✅ Setup complete.\n')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\n❌ Setup failed — rolled back.\n', err)
    process.exit(1)
  } finally {
    client.release()
  }
}

setup()
```

- [ ] **Step 2: Verify the file parses**

```bash
node --input-type=module < scripts/setup-dogfood.js 2>&1 | head -5
```

Expected output: `🐾 FlowOS Dogfood Setup` followed by `✅ Setup complete.` (since the body is empty). No syntax errors.

---

## Task 4: Create the FlowOS Development Org

**Files:**
- Modify: `scripts/setup-dogfood.js` (add org creation block inside `try` after `BEGIN`)

- [ ] **Step 1: Add system org lookup and dogfood org creation**

Replace `// steps go here` with:

```js
    // ── System org ─────────────────────────────────────────────────────────
    console.log('Looking up system org...')
    const sysOrgRow = await client.query(
      "SELECT id FROM blueprint.organizations WHERE slug = 'system' LIMIT 1"
    )
    if (!sysOrgRow.rows.length) {
      throw new Error('System org not found. Run npm run seed first to initialize base data.')
    }
    const systemOrgId = sysOrgRow.rows[0].id
    console.log(`  ✓ System org (id: ${systemOrgId})`)

    // ── Dogfood org ────────────────────────────────────────────────────────
    console.log('\nCreating FlowOS Development org...')
    const orgUri = generateUri('flowos-dev', 'orgs')
    const orgRow = await upsertOne(client, `
      INSERT INTO blueprint.organizations (uri, slug, name, org_type, is_active)
      VALUES ($1, 'flowos-dev', 'FlowOS Development', 'team', true)
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `, [orgUri], 'FlowOS Development org')
    const orgId = orgRow.id
```

- [ ] **Step 2: Run and verify**

```bash
node scripts/setup-dogfood.js
```

Expected:
```
🐾 FlowOS Dogfood Setup

Looking up system org...
  ✓ System org (id: 1)

Creating FlowOS Development org...
  ✓ FlowOS Development org (id: N)

✅ Setup complete.
```

- [ ] **Step 3: Verify in database**

```bash
docker exec flowos-postgres psql -U flowos -d flowos -c "SELECT id, slug, name FROM blueprint.organizations WHERE slug = 'flowos-dev';"
```

Expected: one row.

- [ ] **Step 4: Run again to verify idempotency**

```bash
node scripts/setup-dogfood.js
```

Expected: same output, no error, no duplicate org.

---

## Task 5: Create the Feature Development Workflow

**Files:**
- Modify: `scripts/setup-dogfood.js` (append inside `try` block)

- [ ] **Step 1: Add workflow, stages, and transitions**

Append after the org creation block (still inside `try`):

```js
    // ── Workflow ───────────────────────────────────────────────────────────
    console.log('\nCreating Feature Development workflow...')

    const wfRow = await upsertOne(client, `
      INSERT INTO blueprint.workflows
        (uri, owner_org_id, name, description, version, is_system_default, is_active)
      VALUES ($1, $2, 'Feature Development',
        'Eight-stage Kanban workflow for managing FlowOS feature development.',
        '1.0.0', false, true)
      ON CONFLICT (owner_org_id, name) DO UPDATE SET description = EXCLUDED.description
      RETURNING id
    `, [generateUri('flowos-dev', 'workflows'), orgId], 'Feature Development workflow')
    const wfId = wfRow.id

    // ── Stages ────────────────────────────────────────────────────────────
    console.log('\nCreating stages...')
    const stageDefs = [
      { key: 'backlog',    name: 'Backlog',    class: 'intake',       type: 'waiting', order: 1, entry: true,  terminal: false, waitQueue: false, wip: null },
      { key: 'todo',       name: 'Todo',       class: 'queued',       type: 'waiting', order: 2, entry: false, terminal: false, waitQueue: false, wip: 8    },
      { key: 'discovery',  name: 'Discovery',  class: 'in-progress',  type: 'working', order: 3, entry: false, terminal: false, waitQueue: false, wip: null },
      { key: 'planning',   name: 'Planning',   class: 'in-progress',  type: 'working', order: 4, entry: false, terminal: false, waitQueue: false, wip: null },
      { key: 'devtest',    name: 'Dev/Test',   class: 'in-progress',  type: 'working', order: 5, entry: false, terminal: false, waitQueue: true,  wip: null },
      { key: 'deployment', name: 'Deployment', class: 'delivery',     type: 'working', order: 6, entry: false, terminal: false, waitQueue: false, wip: null },
      { key: 'review',     name: 'Review',     class: 'review',       type: 'working', order: 7, entry: false, terminal: false, waitQueue: false, wip: null },
      { key: 'done',       name: 'Done',       class: 'done',         type: 'waiting', order: 8, entry: false, terminal: true,  waitQueue: false, wip: null },
    ]

    const stageIds = {}
    for (const s of stageDefs) {
      const row = await upsertOne(client, `
        INSERT INTO blueprint.stages (
          uri, workflow_id, name, stage_class, stage_type,
          display_order, is_entry_stage, is_terminal,
          has_waiting_queue, is_active
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
        ON CONFLICT (workflow_id, name) DO UPDATE
          SET stage_class = EXCLUDED.stage_class, display_order = EXCLUDED.display_order
        RETURNING id
      `, [
        generateUri('flowos-dev', 'stages'), wfId,
        s.name, s.class, s.type, s.order, s.entry, s.terminal, s.waitQueue,
      ], `Stage: ${s.name}`)
      stageIds[s.key] = row.id
    }

    // ── Org WIP limit for Todo ─────────────────────────────────────────────
    await client.query(`
      INSERT INTO blueprint.org_wip_limits (org_id, stage_name, wip_limit, enforcement_type)
      VALUES ($1, 'Todo', 8, 'soft')
      ON CONFLICT (org_id, stage_name) DO UPDATE SET wip_limit = EXCLUDED.wip_limit
    `, [orgId])
    console.log('  ✓ WIP limit: Todo = 8 (soft)')

    // ── Transitions ────────────────────────────────────────────────────────
    console.log('\nCreating transitions...')
    const transitionDefs = [
      { from: 'backlog',    to: 'todo',       label: 'Add to Todo',          kind: 'forward'  },
      { from: 'todo',       to: 'discovery',  label: 'Start Discovery',      kind: 'forward'  },
      { from: 'todo',       to: 'planning',   label: 'Skip to Planning',     kind: 'forward'  },
      { from: 'discovery',  to: 'planning',   label: 'Start Planning',       kind: 'forward'  },
      { from: 'planning',   to: 'devtest',    label: 'Start Dev',            kind: 'forward'  },
      { from: 'devtest',    to: 'deployment', label: 'Deploy',               kind: 'forward'  },
      { from: 'deployment', to: 'review',     label: 'Start Review',         kind: 'forward'  },
      { from: 'deployment', to: 'done',       label: 'Done (skip review)',   kind: 'forward'  },
      { from: 'review',     to: 'done',       label: 'Done',                 kind: 'forward'  },
      { from: 'review',     to: 'devtest',    label: 'Send back to Dev',     kind: 'backward' },
      { from: 'discovery',  to: 'todo',       label: 'Back to Todo',         kind: 'backward' },
      { from: 'planning',   to: 'discovery',  label: 'Back to Discovery',    kind: 'backward' },
    ]

    for (const t of transitionDefs) {
      await client.query(`
        INSERT INTO blueprint.stage_transitions
          (from_stage_id, to_stage_id, transition_label, transition_kind, requires_reason, is_active)
        VALUES ($1,$2,$3,$4,false,true)
        ON CONFLICT (from_stage_id, to_stage_id) DO UPDATE
          SET transition_label = EXCLUDED.transition_label
      `, [stageIds[t.from], stageIds[t.to], t.label, t.kind])
    }
    console.log(`  ✓ ${transitionDefs.length} transitions`)
```

- [ ] **Step 2: Run and verify**

```bash
node scripts/setup-dogfood.js
```

Expected: stages and transitions printed, no errors.

- [ ] **Step 3: Verify stage count in database**

```bash
docker exec flowos-postgres psql -U flowos -d flowos -c "SELECT name, stage_class, display_order FROM blueprint.stages WHERE workflow_id = (SELECT id FROM blueprint.workflows WHERE name = 'Feature Development') ORDER BY display_order;"
```

Expected: 8 rows in order (Backlog through Done).

---

## Task 6: Create WIT Classes and Types

**Files:**
- Modify: `scripts/setup-dogfood.js` (append inside `try` block)

Note: Feature and Bug WIT classes already exist in the system seed. Only Tech Debt is new.

- [ ] **Step 1: Add WIT class and type creation**

Append after the transitions block:

```js
    // ── WIT Classes ────────────────────────────────────────────────────────
    console.log('\nResolving WIT classes...')

    // Feature and Bug already exist from seed. Upsert all three defensively.
    const classDefs = [
      { name: 'Feature',   description: 'A user-facing capability.',                          isSystem: true  },
      { name: 'Bug',       description: 'A defect or unintended behavior.',                   isSystem: true  },
      { name: 'Tech Debt', description: 'Refactoring, cleanup, or architectural improvement.', isSystem: false },
    ]
    const classIds = {}
    for (const c of classDefs) {
      const existing = await client.query(
        'SELECT id FROM blueprint.work_item_type_classes WHERE owner_org_id = $1 AND name = $2',
        [systemOrgId, c.name]
      )
      if (existing.rows.length) {
        classIds[c.name] = existing.rows[0].id
        console.log(`  ✓ Class: ${c.name} (existing, id: ${existing.rows[0].id})`)
      } else {
        const row = await upsertOne(client, `
          INSERT INTO blueprint.work_item_type_classes
            (uri, owner_org_id, name, description, is_system_default)
          VALUES ($1,$2,$3,$4,$5)
          RETURNING id
        `, [generateSystemUri('work-item-type-classes'), systemOrgId, c.name, c.description, c.isSystem],
        `Class: ${c.name} (created)`)
        classIds[c.name] = row.id
      }
    }

    // ── WIT Types (org-scoped) ─────────────────────────────────────────────
    console.log('\nCreating WIT types for flowos-dev...')

    const typeDefs = [
      { name: 'Feature',   class: 'Feature',   icon: '⭐', color: '#8B5CF6', prefix: 'FEAT' },
      { name: 'Bug',       class: 'Bug',        icon: '🐛', color: '#EF4444', prefix: 'BUG'  },
      { name: 'Tech Debt', class: 'Tech Debt',  icon: '🔧', color: '#6B7280', prefix: 'DEBT' },
    ]
    const typeIds = {}
    for (const t of typeDefs) {
      const existing = await client.query(
        'SELECT id FROM blueprint.work_item_types WHERE owner_org_id = $1 AND name = $2',
        [orgId, t.name]
      )
      let typeId
      if (existing.rows.length) {
        typeId = existing.rows[0].id
        console.log(`  ✓ Type: ${t.name} (existing, id: ${typeId})`)
      } else {
        const row = await upsertOne(client, `
          INSERT INTO blueprint.work_item_types (
            uri, owner_org_id, class_id, name, description,
            version, request_mode, is_published, is_system_default,
            icon, color, key_prefix
          ) VALUES ($1,$2,$3,$4,$5,'1.0.0','user_requestable',true,false,$6,$7,$8)
          RETURNING id
        `, [
          generateUri('flowos-dev', 'work-item-types'), orgId, classIds[t.class],
          t.name, `${t.name} work item for FlowOS development.`,
          t.icon, t.color, t.prefix,
        ], `Type: ${t.name} (created)`)
        typeId = row.id
      }
      typeIds[t.name] = typeId

      // Link type to workflow
      await client.query(`
        INSERT INTO blueprint.work_item_type_workflows (work_item_type_id, workflow_id, is_current)
        VALUES ($1, $2, true)
        ON CONFLICT DO NOTHING
      `, [typeId, wfId])
    }
```

- [ ] **Step 2: Run and verify**

```bash
node scripts/setup-dogfood.js
```

Expected: Tech Debt class created, all three types created/confirmed, no errors.

- [ ] **Step 3: Verify in database**

```bash
docker exec flowos-postgres psql -U flowos -d flowos -c "SELECT wit.name, wit.key_prefix, witc.name AS class FROM blueprint.work_item_types wit JOIN blueprint.work_item_type_classes witc ON witc.id = wit.class_id WHERE wit.owner_org_id = (SELECT id FROM blueprint.organizations WHERE slug = 'flowos-dev');"
```

Expected: 3 rows — Feature/FEAT, Bug/BUG, Tech Debt/DEBT.

---

## Task 7: Create Agent User

**Files:**
- Modify: `scripts/setup-dogfood.js` (append inside `try` block)

Note: `api_token` is stored for future use when Bearer token auth is implemented (see Questions at end of plan). The MCP server currently uses `FLOWOS_AGENT_USER_ID` (direct DB), not the API key.

- [ ] **Step 1: Add agent user creation**

Append after the WIT types block:

```js
    // ── Agent User ─────────────────────────────────────────────────────────
    console.log('\nCreating agent user...')

    const agentEmail = 'agent@flowos.internal'
    const existingAgent = await client.query(
      'SELECT id, api_token FROM blueprint.users WHERE email = $1', [agentEmail]
    )

    let agentId
    let apiKey
    if (existingAgent.rows.length) {
      agentId = existingAgent.rows[0].id
      apiKey  = existingAgent.rows[0].api_token
      console.log(`  ✓ Agent user (existing, id: ${agentId})`)
    } else {
      apiKey = `fos_ak_${randomBytes(32).toString('hex')}`
      const agentUri = generateUri('flowos-dev', 'users')
      const agentRow = await upsertOne(client, `
        INSERT INTO blueprint.users
          (uri, email, display_name, is_active, is_agent, api_token)
        VALUES ($1, $2, 'FlowOS Agent', true, true, $3)
        RETURNING id
      `, [agentUri, agentEmail, apiKey], 'Agent user (created)')
      agentId = agentRow.id
    }

    // Ensure agent is a member of the dogfood org
    const adminRoleRow = await client.query(
      "SELECT id FROM blueprint.roles WHERE name = 'Admin' LIMIT 1"
    )
    if (adminRoleRow.rows.length) {
      await client.query(`
        INSERT INTO blueprint.org_memberships (user_id, org_id, role_id, is_active)
        VALUES ($1, $2, $3, true)
        ON CONFLICT (user_id, org_id) DO NOTHING
      `, [agentId, orgId, adminRoleRow.rows[0].id])
      console.log('  ✓ Agent added to flowos-dev org (Admin role)')
    }
```

- [ ] **Step 2: Add .env writer**

Append immediately after the agent user block:

```js
    // ── Write to .env ──────────────────────────────────────────────────────
    console.log('\nWriting agent credentials to .env...')
    const envPath = new URL('../.env', import.meta.url).pathname
    let envContent = ''
    try { envContent = await readFile(envPath, 'utf8') } catch { /* .env may not exist */ }

    // Remove any existing FLOWOS_AGENT_USER_ID / FLOWOS_API_KEY lines
    envContent = envContent.replace(/^FLOWOS_AGENT_USER_ID=.*$/m, '').replace(/^FLOWOS_API_KEY=.*$/m, '')
    // Trim trailing blank lines and append
    envContent = envContent.trimEnd() + `\nFLOWOS_AGENT_USER_ID=${agentId}\nFLOWOS_API_KEY=${apiKey}\n`
    await writeFile(envPath, envContent)
    console.log(`  ✓ FLOWOS_AGENT_USER_ID=${agentId}`)
    console.log(`  ✓ FLOWOS_API_KEY=${apiKey.slice(0, 16)}... (truncated)`)
```

- [ ] **Step 3: Run and verify**

```bash
node scripts/setup-dogfood.js
grep "FLOWOS_AGENT_USER_ID\|FLOWOS_API_KEY" .env
```

Expected: both lines present in `.env`.

- [ ] **Step 4: Run again to verify idempotency**

```bash
node scripts/setup-dogfood.js
grep "FLOWOS_AGENT_USER_ID\|FLOWOS_API_KEY" .env
```

Expected: same IDs — no duplicates, existing agent user reused.

---

## Task 8: Seed Org Context Library

**Files:**
- Modify: `scripts/setup-dogfood.js` (append inside `try` block)

- [ ] **Step 1: Add org context seeding**

Append after the .env writer block:

```js
    // ── Org Context Library ────────────────────────────────────────────────
    console.log('\nSeeding org context library...')

    const contextEntries = [
      // Architecture
      { type: 'architecture', title: 'Two-schema discipline',
        content: 'PostgreSQL has two schemas: `blueprint` (structural definitions — orgs, workflows, stages, WIT types, fields) and `runtime` (work instances — work items, events, comments, context entries). Never mix them. Blueprint rows change rarely; runtime rows are high-volume append/update.' },
      { type: 'architecture', title: 'Transition engine — two-phase model',
        content: 'All work item stage transitions go through two phases. `prepare` evaluates exit criteria and returns a preview of what would change (does not commit). `execute` commits the transition, emits the event, and fires post-transition side effects (playbooks, notifications). Exit criteria GATE transitions. Playbooks and notification dispatches are SIDE EFFECTS — they never block the response.' },
      { type: 'architecture', title: 'Event system — append-only log',
        content: '`runtime.events` is an append-only event log. Emit events via `emitEvent(client, ...)` inside a transaction, then call `nudgeAfterCommit()` to wake the processor. The event processor holds a PG advisory lock — only one instance runs at a time. Subscribers in `runtime/subscribers/` are registered handlers. The search index, notifications, Neo4j sync, and audit trail all run as subscribers.' },
      { type: 'architecture', title: 'API request flow',
        content: 'Requests flow: `api/server.js` (middleware, route mounting) → route handler → domain module in `runtime/` or `admin/` → `db/postgres.js` (parameterized SQL via `pg` pool). No ORM. No string interpolation in SQL queries — ever. All user-supplied values go through parameterized query placeholders ($1, $2, ...).' },
      { type: 'architecture', title: 'MCP server — current limitation',
        content: 'The MCP server at `mcp/flowos-context-server.js` currently connects directly to PostgreSQL (imports `pool` from `db/postgres.js`). This is a known architectural gap. It should call the FlowOS REST API instead. The refactor is tracked as Feature FEAT.1 in this org. Until then, the MCP server requires direct DB access and can only run on a machine with database connectivity.' },
      // Standards
      { type: 'standard', title: 'ES modules everywhere',
        content: 'All JavaScript files use `import`/`export` syntax — never `require()`. The only exception is `tailwind.config.js` which uses CommonJS due to jiti compatibility. Node.js runtime is v24+. All files must be `.js` — no TypeScript.' },
      { type: 'standard', title: 'Parameterized SQL — no exceptions',
        content: 'Every database query uses parameterized placeholders ($1, $2, ...). No string interpolation, no template literals, no concatenation in SQL. This is non-negotiable — SQL injection is an automatic reject.' },
      { type: 'standard', title: 'React components — functional only, under 200 lines',
        content: 'All React components are functional (no class components). Component files must stay under 200 lines. When a component grows beyond that, extract sub-components into separate files. No `font-mono` class anywhere. Only `text-xs` (12px) and `text-sm` (14px) font sizes — no arbitrary pixel sizes.' },
      { type: 'standard', title: 'No modals — drawer only',
        content: 'The only overlay pattern in the UI is the right-side Sheet (drawer). No modals, no dialogs, no centered overlays. If a design requires an overlay, it is a drawer.' },
      { type: 'standard', title: 'Lint before done',
        content: 'Run `npx eslint .` from the project root before declaring any task complete. A task is not done if lint fails.' },
      // Process
      { type: 'process', title: 'Pull, not push',
        content: 'Work is pulled downstream when capacity exists. Nothing is auto-advanced into a stage that has not signaled readiness. WIP limits enforce this. Violating this principle breaks the flow model.' },
      { type: 'process', title: 'WIP limits expose problems',
        content: 'WIP limits are diagnostic tools, not preventive ones. When a limit is hit, the correct response is to investigate the constraint — not to raise the limit or silently ignore it.' },
      { type: 'process', title: 'Just-in-time context',
        content: 'Discovery and Planning context entries have a useful life. If a Planning entry is written and the item sits in the backlog for weeks while other features ship, the design assumptions may be stale. Before starting Dev/Test on an item whose Planning entries are old, review them against recent changes.' },
    ]

    let ctxCreated = 0
    let ctxSkipped = 0
    for (const entry of contextEntries) {
      const existing = await client.query(
        'SELECT id FROM blueprint.org_context WHERE org_id = $1 AND title = $2',
        [orgId, entry.title]
      )
      if (existing.rows.length) {
        ctxSkipped++
      } else {
        await client.query(`
          INSERT INTO blueprint.org_context (org_id, type, title, content, author_id)
          VALUES ($1, $2, $3, $4, $5)
        `, [orgId, entry.type, entry.title, entry.content, agentId])
        ctxCreated++
      }
    }
    console.log(`  ✓ ${ctxCreated} entries created, ${ctxSkipped} already existed`)
```

- [ ] **Step 2: Run and verify**

```bash
node scripts/setup-dogfood.js
```

Expected: `13 entries created, 0 already existed` on first run.

- [ ] **Step 3: Run again to verify idempotency**

```bash
node scripts/setup-dogfood.js
```

Expected: `0 entries created, 13 already existed`.

---

## Task 9: Merge MCP Settings and Print Summary

**Files:**
- Modify: `scripts/setup-dogfood.js` (append inside `try` block, before `COMMIT`)

- [ ] **Step 1: Add MCP settings merge and summary printer**

Append before the `await client.query('COMMIT')` line:

```js
    // ── MCP Registration ───────────────────────────────────────────────────
    console.log('\nRegistering MCP server in .claude/settings.json...')
    const settingsPath = new URL('../.claude/settings.json', import.meta.url).pathname
    let settings = {}
    try { settings = JSON.parse(await readFile(settingsPath, 'utf8')) } catch { /* file may not exist yet */ }

    settings.mcpServers = settings.mcpServers || {}
    settings.mcpServers.flowos = {
      command: 'node',
      args:    [new URL('../mcp/flowos-context-server.js', import.meta.url).pathname],
      env: {
        DATABASE_URL:           `postgresql://${process.env.POSTGRES_USER || 'flowos'}:${process.env.POSTGRES_PASSWORD || 'flowos_dev'}@${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || 5432}/${process.env.POSTGRES_DB || 'flowos'}`,
        FLOWOS_AGENT_USER_ID:   String(agentId),
      },
    }
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n')
    console.log('  ✓ .claude/settings.json updated')

    // ── Summary ────────────────────────────────────────────────────────────
    console.log('\n' + '─'.repeat(60))
    console.log('DOGFOOD ORG SUMMARY')
    console.log('─'.repeat(60))
    console.log(`Org:              FlowOS Development (id: ${orgId}, slug: flowos-dev)`)
    console.log(`Workflow:         Feature Development (id: ${wfId})`)
    console.log(`Stages:`)
    for (const [key, id] of Object.entries(stageIds)) {
      console.log(`  ${key.padEnd(12)} id: ${id}`)
    }
    console.log(`WIT Types:`)
    for (const [name, id] of Object.entries(typeIds)) {
      console.log(`  ${name.padEnd(12)} id: ${id}`)
    }
    console.log(`Agent user:       id: ${agentId}, email: agent@flowos.internal`)
    console.log(`FLOWOS_AGENT_USER_ID=${agentId}`)
    console.log(`FLOWOS_API_KEY=   ${apiKey.slice(0, 20)}... (see .env for full value)`)
    console.log('─'.repeat(60))
```

- [ ] **Step 2: Run the complete setup script**

```bash
node scripts/setup-dogfood.js
```

Expected: full output with all sections, summary table at the end, no errors.

- [ ] **Step 3: Verify .claude/settings.json has the MCP entry while keeping existing permissions**

```bash
cat .claude/settings.json
```

Expected: JSON with both `permissions` (existing) and `mcpServers.flowos` (new). No content lost.

- [ ] **Step 4: Commit the setup script**

```bash
git add scripts/setup-dogfood.js
git commit -m "feat(dogfood): org setup script — workflow, types, agent user, org context, MCP registration"
```

---

## Task 10: Write `scripts/load-dogfood-items.js`

**Files:**
- Create: `scripts/load-dogfood-items.js`

- [ ] **Step 1: Create the file**

```js
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
    // priority: 1 = highest, 3 = low
    // stage: name of target stage (items normally land in Backlog, Todo is an override)
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
```

- [ ] **Step 2: Verify syntax**

```bash
node --check scripts/load-dogfood-items.js
```

Expected: no output (clean parse).

---

## Task 11: Run the Load Script and Verify the Board

- [ ] **Step 1: Ensure the API server is running**

```bash
pm2 status
```

Expected: `flowos-api` status `online`. If not: `pm2 start npm --name flowos-api -- start`

- [ ] **Step 2: Run the load script**

```bash
node scripts/load-dogfood-items.js
```

Expected: 15 items printed (FEAT.N — title), 0 skipped.

- [ ] **Step 3: Verify item count in database**

```bash
docker exec flowos-postgres psql -U flowos -d flowos -c "SELECT display_key, title, priority FROM runtime.work_items WHERE owner_org_id = (SELECT id FROM blueprint.organizations WHERE slug = 'flowos-dev') ORDER BY priority, display_key;"
```

Expected: 15 rows. FEAT.1 (MCP refactor) should show priority 1.

- [ ] **Step 4: Verify the MCP refactor item is in Todo**

```bash
docker exec flowos-postgres psql -U flowos -d flowos -c "SELECT wi.title, s.name AS stage FROM runtime.work_items wi JOIN blueprint.stages s ON s.id = wi.current_stage_id WHERE wi.title = 'MCP Server → REST API refactor';"
```

Expected: stage = `Todo`.

- [ ] **Step 5: Open the board in a browser and verify**

Open `http://localhost:3000/admin/` in a browser. Select the FlowOS Development org. Navigate to the board.

Expected:
- 8 columns: Backlog, Todo, Discovery, Planning, Dev/Test, Deployment, Review, Done
- MCP refactor card visible in the Todo column
- All other items in Backlog
- Dev/Test column renders with a waiting-queue split (two sub-columns)

- [ ] **Step 6: Commit**

```bash
git add scripts/load-dogfood-items.js
git commit -m "feat(dogfood): work item loader — 15 initial backlog items"
```

---

## Task 12: Verify MCP Server in Claude Code

- [ ] **Step 1: Start a new Claude Code session in the flowos directory**

Close and reopen Claude Code (or open a new terminal session). This forces Claude Code to reload `~/.claude/settings.json` (or `.claude/settings.json`).

- [ ] **Step 2: Confirm the MCP server is available**

In the new Claude Code session, ask:

> "Use the FlowOS MCP server to list context entries for work item 1."

If the server is registered and the database is running, Claude should return results (or an empty list if no context entries exist yet for that item ID).

- [ ] **Step 3: Test a search**

In the Claude Code session, ask:

> "Use the FlowOS MCP server to search work items in org flowos-dev for items related to MCP."

Expected: the MCP refactor item returned.

- [ ] **Step 4: If MCP server fails to connect — diagnose**

```bash
# Check the MCP server starts manually
FLOWOS_AGENT_USER_ID=$(grep FLOWOS_AGENT_USER_ID .env | cut -d= -f2) \
DATABASE_URL="postgresql://flowos:flowos_dev@localhost:5432/flowos" \
node mcp/flowos-context-server.js
```

If it prints `FlowOS MCP server running` (or similar), the issue is with Claude Code's settings path. Check that `.claude/settings.json` has the `mcpServers.flowos` entry and that the `args` path is absolute and correct.

---

## Questions Batched for Chris

These are decisions or unknowns that surfaced while writing the plan. None block implementation — the plan proceeds with safe defaults and these can be answered when you return.

**Q1 — API key auth middleware not implemented yet.**
The `api_token` column exists on `blueprint.users` and the `fos_ak_` prefix convention is documented in CLAUDE.md, but no Bearer token authentication middleware exists in `api/server.js` or `core/auth.js`. The `requireAuth` middleware only checks `req.session?.userId`. This means the MCP → REST API refactor (Feature FEAT.1) must include implementing the Bearer token middleware as part of its scope. When it lands, it should check the `Authorization: Bearer fos_ak_...` header, look up the user by `api_token`, and set `req.userId` the same way session auth does. Is this the correct approach, or did you have a different auth scheme in mind for API keys?

**Q2 — Org type for `flowos-dev`.**
The setup script creates the dogfood org with `org_type = 'team'`. The existing org_types in the seed include: `system`, `enterprise`, `division`, `department`, `team`, `pod`. `team` seems right for a solo-developer org, but verify this is the right choice when you have a moment. It affects how the org renders in the org tree.

**Q3 — Service class for dogfood work items.**
The load script assigns the `Standard` service class to all initial work items. This means none are expedited or date-driven. If any items should be marked `is_expedited = true` (Expedite class of service) or given a `due_date` (Fixed Date class), those can be set manually in the UI after loading. No action needed unless you want the script to set them.

**Q4 — Admin user membership.**
The setup script creates an agent user and adds it to the dogfood org. Your own user account (the one you created via the setup wizard) is NOT automatically added as a member of the `flowos-dev` org by this script — that would require knowing your user ID. After running the scripts, you'll need to add yourself to the FlowOS Development org via Org Center → Members. Should the setup script ask for your email and add you automatically, or is manual via UI fine?

---

## Post-Setup Checklist

After all tasks complete, the dogfood environment is live when:

- [ ] `http://localhost:3000/admin/` shows the FlowOS board after login
- [ ] FlowOS Development org is visible in the org selector
- [ ] The Feature Development workflow has 8 columns on the board
- [ ] FEAT.1 (MCP refactor) is visible in the Todo column
- [ ] 14 additional items are visible in the Backlog column
- [ ] The Claude Code MCP tool `search_work_items` returns results
- [ ] PM2 shows `flowos-api` as `online` after a machine restart test (optional but recommended)
