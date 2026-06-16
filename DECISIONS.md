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

### [2026-06-16] [ARCH] MCP server connects directly to PostgreSQL — deferred fix

**What:** `mcp/flowos-context-server.js` imports `pool` from `db/postgres.js` directly instead of calling the FlowOS REST API via HTTP. Identified during dogfood design. Deferred to work item FEAT.25338 (currently in Todo on the dogfood board).

**Why deferred:** Dogfood environment works correctly locally in the interim. Fixing it requires implementing Bearer token auth middleware first (fos_ak_ tokens are stored but the middleware doesn't exist yet in `requireAuth`).

**Tradeoffs:** MCP server is not portable until fixed (requires direct DB access). Acceptable for local dogfooding; blocking for remote/multi-instance use.

**Status:** Active (since 2026-06-16) — see FEAT.25338 for the fix plan
