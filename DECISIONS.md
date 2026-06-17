# DECISIONS — FlowOS

Append-only log of architectural, strategic, and process decisions.
Tags: [STRATEGY] [SCOPE] [ARCH] [DESIGN] [VENDOR] [PRICING] [PROCESS] [LEGAL]

---

### [2026-06-16] [PROCESS] Dogfood-first development

**What:** Stood up a persistent local FlowOS instance ("FlowOS Development" org, slug: `flowos-dev`) to manage FlowOS's own feature development using the system itself.

**Why:** Forces real usage of every subsystem — context, playbooks, MCP tools, board, transitions. Gaps surface immediately because we are the users. Already identified: MCP server direct-DB access (logged as FEAT.25338).

**Tradeoffs:** Requires local environment to be running (Docker + PM2). Adds minor maintenance overhead vs. a TODO list. Worth it — the dogfood environment is the primary development tool going forward.

**Status:** Active (since 2026-06-16)

---

### [2026-06-17] [STRATEGY] FlowOS boundary principle — workflow ownership vs. domain execution

**What:** FlowOS owns the flow and the quality of the flow. Workers own the work itself.

FlowOS **does:**
- Manage flow state, transitions, WIP limits, metrics
- Provide AI augmentation at the workflow layer (playbooks, skills, context assembly)
- Assemble and distribute structured context (journal, decisions, acceptance criteria, org context)
- Verify that workflow-level quality standards are met (quality gates via playbooks and transition actions)
- Accept workflow-relevant outcomes back from workers via MCP tools
- Trigger external quality checks (call scripts, APIs, webhooks) and report pass/fail results

FlowOS **does not:**
- Execute domain work (write code, generate creative content, build artifacts, run builds)
- Access domain tools for execution purposes
- Fix quality violations — it detects and surfaces them; the worker resolves them

**The MCP server is the bridge:** FlowOS context flows out to the worker's environment (Claude Desktop, Cursor, any IDE). Workflow-relevant outcomes (decisions made, status changes, context entries) flow back in. FlowOS never needs to see the artifact itself — only the workflow-level metadata about it.

**Quality gates are a workflow concern, not a domain concern:** Checking that a PR is linked to a work item, that naming conventions are followed, that required approvals exist — these are questions about whether the workflow's standards are being upheld. Playbooks can trigger these checks via api_call actions or external webhooks, then write results as context entries or exit criterion signals. The distinction: *verify* is in scope, *fix* is not.

**Why this matters for product scope:** FlowOS applies equally to shipping software, writing a TV episode, running an ad campaign, or managing a legal matter. The domain is irrelevant. This principle keeps FlowOS general-purpose and prevents scope creep into domain-specific tooling.

**Status:** Active (since 2026-06-17) — governing principle for all AI feature decisions

---

### [2026-06-16] [ARCH] MCP server connects directly to PostgreSQL — deferred fix

**What:** `mcp/flowos-context-server.js` imports `pool` from `db/postgres.js` directly instead of calling the FlowOS REST API via HTTP. Identified during dogfood design. Deferred to work item FEAT.25338 (currently in Todo on the dogfood board).

**Why deferred:** Dogfood environment works correctly locally in the interim. Fixing it requires implementing Bearer token auth middleware first (fos_ak_ tokens are stored but the middleware doesn't exist yet in `requireAuth`).

**Tradeoffs:** MCP server is not portable until fixed (requires direct DB access). Acceptable for local dogfooding; blocking for remote/multi-instance use.

**Status:** Active (since 2026-06-16) — see FEAT.25338 for the fix plan
