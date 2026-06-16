# FlowOS Dogfood Environment — Design Spec

**Date:** 2026-06-15
**Status:** Approved
**Scope:** Stand up a persistent local FlowOS instance to manage FlowOS's own feature development, using the system's context, playbooks, and MCP tools in anger.

---

## Purpose

FlowOS's dogfood environment is a live instance of FlowOS running locally that tracks FlowOS's own feature development. It exercises every part of the system — intake, journal entries, org context, stage playbooks, and the MCP server — as real work moves through a real board. Gaps and rough edges surface immediately because we are the users.

This is not a staging environment. It is the primary tool for managing FlowOS development going forward.

---

## What Is Out of Scope

- **MCP Server → REST API refactor:** This is an architectural gap identified during the dogfooding design process. It is the first Feature work item loaded into the dogfood org and will be planned and executed through the workflow. It is not a prerequisite for standing up the environment.
- **Stage playbooks:** Playbooks are authored iteratively after the org is running. Write the Discovery playbook first, run an item through it, observe what the agent produces, then refine. All eight playbooks in a single upfront pass would produce untested automation.
- **Railway or remote deployment:** Local-only for now. Remote deployment is a future work item if needed.

---

## Section 1 — Persistent Local Environment

### Goal
FlowOS runs on startup without manual intervention. Docker handles the databases; PM2 handles the Node.js API server.

### Docker
All three services in `docker-compose.yml` (PostgreSQL, Neo4j, MinIO) already have `restart: unless-stopped`. The only required change is enabling **Start Docker Desktop when you log in to your Mac** in Docker Desktop → Settings → General. After that, one `docker compose up -d` is all that's needed. PostgreSQL data persists in the `postgres_data` named volume. Only `docker compose down -v` destroys it, which is explicit and intentional.

### Node.js API Server (PM2)
PM2 manages the API server process and registers it with macOS launchd so it starts on login.

```bash
npm install -g pm2
pm2 start npm --name flowos-api -- start   # runs npm start (no file watch)
pm2 save
pm2 startup                                 # generates and registers launchd plist
```

PM2 runs `npm start` (no nodemon), not `npm run dev`. The standing instance is stable. During active development sessions, run `npm run dev` in a terminal alongside PM2, or stop the PM2 process temporarily.

### Admin UI
Build once: `cd admin-ui && npm run build`. The API server serves the built static files at `/admin/`. During active UI development, also start the Vite dev server on port 5173 as usual. After shipping a UI change, rebuild to update the standing instance.

---

## Section 2 — Dogfood Org Setup Script

**File:** `scripts/setup-dogfood.js`

Uses direct database and runtime module access (same pattern as `seed.js`). The script is **idempotent** — it checks whether each resource exists before creating it, keyed on stable slugs and names. Running it twice is safe.

### Org
Creates organization `"FlowOS Development"` with slug `flowos-dev`.

### Workflow
Creates workflow `"Feature Development"` with 8 stages in sequence:

| Stage | Stage Class | WIP Limit | has_waiting_queue |
|-------|-------------|-----------|-------------------|
| Backlog | `queued` | none | false |
| Todo | `queued` | 8 | false |
| Discovery | `active` | — | false |
| Planning | `active` | — | false |
| Dev/Test | `active` | — | true |
| Deployment | `active` | — | false |
| Review | `active` | — | false |
| Done | `done` | — | false |

`has_waiting_queue: true` on Dev/Test reflects real flow: items are often pulled into the stage before the previous item finishes, creating a visible waiting pool.

### Work Item Types
Creates three WIT Classes in the system org if they don't already exist (Feature, Bug, Tech Debt), then creates three WIT Types in `flowos-dev` from those classes, all assigned to the Feature Development workflow.

### Agent User
Creates a user row with:
- `display_name`: "FlowOS Agent"
- `email`: `agent@flowos.internal`
- `is_agent`: true
- `is_active`: true
- `api_token`: generated `fos_ak_` prefixed key

The script appends two lines to `.env`:
```
FLOWOS_API_KEY=fos_ak_<generated>
FLOWOS_AGENT_USER_ID=<integer id>
```

### Org Context Library
Seeds the `blueprint.org_context` table with entries drawn from existing project docs:

| Type | Content |
|------|---------|
| `architecture` | Two-schema discipline (blueprint = structure, runtime = instances) |
| `architecture` | Transition engine: two-phase prepare → execute; exit criteria gate, actions are side effects |
| `architecture` | Event system: append-only `runtime.events` log, emit in-transaction, nudge post-commit |
| `architecture` | Request flow: `api/server.js` → route mounting → `admin/api.js` → `runtime/` → `db/postgres.js` |
| `standard` | ES modules everywhere — `import`/`export`, never `require()` (except `tailwind.config.js`) |
| `standard` | Parameterize all SQL — no string interpolation in queries |
| `standard` | Functional React components only; component files under 200 lines |
| `standard` | No modals — the only overlay pattern is the right-side drawer (Sheet) |
| `standard` | Run `npx eslint .` before declaring any task complete |
| `process` | Pull, not push — never auto-advance items without downstream capacity |
| `process` | WIP limits expose problems, they don't prevent work |
| `process` | Policies over process steps — stage policies are automation, not toggles |
| `process` | The system signals its own problems — silent failure is not acceptable |

### Script Output
Prints a summary at the end: org ID, workflow ID, all stage IDs with names, all type IDs, agent user ID, and the API key. Everything needed for MCP registration without querying the database.

---

## Section 3 — MCP Server Registration

The setup script **merges** the following entry into `.claude/settings.json` at the project root as its final step, preserving all existing content (permissions, other MCP servers, etc.):

```json
{
  "mcpServers": {
    "flowos": {
      "command": "node",
      "args": ["/Users/chris/Documents/ai/flowos/mcp/flowos-context-server.js"],
      "env": {
        "DATABASE_URL": "postgresql://flowos:flowos_dev@localhost:5432/flowos",
        "FLOWOS_AGENT_USER_ID": "<written by setup script>"
      }
    }
  }
}
```

The MCP server process spawned by Claude Code does not inherit the project's `.env` file automatically, so env vars are explicit in the settings entry.

**Constraint:** MCP tools only work when the local FlowOS instance is running. If Docker or PM2 are down, tool calls fail with connection errors. The persistent environment from Section 1 makes this a non-issue in normal operation.

After the setup script runs, starting a new Claude Code session in the flowos directory gives Claude access to all 8 MCP tools against the live dogfood database.

---

## Section 4 — Initial Work Items

Loaded by `scripts/load-dogfood-items.js` via `POST /admin/api/work-items`. All items start in **Backlog** except the MCP refactor, which starts in **Todo** as the first item ready to pull into Discovery.

### Priority 1 (immediate)

| Title | Type | Stage |
|-------|------|-------|
| MCP Server → REST API refactor | Feature | **Todo** |

### Priority 2 (next up)

| Title | Type | Notes |
|-------|------|-------|
| Context staleness detection | Feature | Flag stale Planning entries at Dev/Test stage entry |
| Async deployment feedback loop | Feature | Webhook receiver for CI/Sonar; enables long-running deployment playbooks |
| Solution RAG | Feature | pgvector over codebase + context + pipeline items; `context.rag` playbook option |
| Bulk ops integration tests | Tech Debt | `tests/bulk-ops.test.js`; happy path + partial-success |
| Stage-evidence requirements | Feature | Named attachment slots per stage that gate transitions |
| Open-source release prep | Feature | README, LICENSE, seed-and-go experience |
| SLA tracking & alerts | Feature | `sla_hours` exists; need countdown display and breach alerts |
| Markdown in descriptions and comments | Feature | Currently plain text |
| Dashboard / landing page | Feature | Configurable widgets, real summary metrics |
| Cross-org flow visibility (Network Board) | Feature | Killer differentiator; designed, not built |
| Blocking chain analysis | Feature | Neo4j-backed; "what's blocking what" across the system |

### Priority 2 (continued)

| Title | Type | Notes |
|-------|------|-------|
| Apply skills to work items | Feature | On-demand agent skill palette on any work item — distinct from playbooks (which are automated and stage-triggered). User selects a named skill (architecture review, BDD, UX design, proofreading, Gherkin, code review, root cause analysis, reproduce bug, etc.) and invokes it against the current work item. The agent executes with full context (journal, org context, ancestors) and surfaces output. The user responds interactively; the agent can act on that response via MCP (write context entries, transition the item, add comments). Skills write back to the journal using the appropriate entry types — Gherkin → `acceptance`, architecture review → `design`/`decision`, code review → `note`. Completes the agent interaction model: playbooks for automation, skills for on-demand interrogation. |

### Priority 3 (low — backlog depth)

| Title | Type | Notes |
|-------|------|-------|
| Email-to-ticket | Feature | External intake channel |
| Keyboard shortcuts | Feature | Board power-user efficiency |

---

## Architectural Gap Log

Gaps discovered during this design process. Each is a work item in the dogfood org.

| Gap | Work Item |
|-----|-----------|
| MCP server queries PostgreSQL directly instead of calling the REST API — not portable, bypasses auth | MCP Server → REST API refactor (Priority 1, Todo) |
| Playbooks are one-shot; no mechanism for async status checks during Deployment | Async deployment feedback loop (Priority 2) |
| No semantic search over codebase or pipeline items; grepping is too expensive per-playbook | Solution RAG (Priority 2) |
| No staleness detection when Planning entries age out before Dev/Test begins | Context staleness detection (Priority 2) |

---

## Future: Playbooks

Playbooks are out of scope for this initiative but are the next layer of value after the environment is running. The planned approach:

- **Todo entry:** Triage kickoff — open questions, initial NFRs, draft acceptance criteria
- **Discovery entry:** Deep interrogation — decomposition, cross-references, research brief
- **Planning entry:** Spec generation (Opus) — technical design, decisions, locked acceptance criteria
- **Dev/Test entry:** Implementation kickoff (Haiku) — ordered checklist, test plan
- **Deployment entry:** Release runbook — migration order, env vars, smoke test, rollback steps
- **Review entry:** UAT guide — acceptance criteria mapped to review steps
- **Done entry:** Retrospective note — summary for org context accumulation

All playbooks pull from the org context library (architecture, standards, process entries seeded in Section 2). The Solution RAG work item, when complete, adds a `context.rag` option for semantic codebase retrieval.

Playbooks are authored one at a time, starting with Discovery, and refined based on observed agent output.
