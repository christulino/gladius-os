# Gladius OS

An open source work operating system built on Kanban and Lean principles.

**Self-hosted. Not SaaS. MIT licensed.**

Gladius OS treats work as a flow system — the board is a health monitor, not a status tracker. Watch the work move, not the people doing it.

---

## Philosophy

Most tools track people. Gladius OS tracks work.

Inspired by Taiichi Ohno's Toyota Production System, David Anderson's Kanban Method, and Patrick Burrows' work on flow:

- **Pull, don't push.** Work moves when downstream capacity exists, not when upstream decides to push it.
- **WIP limits expose problems.** They don't prevent work — they surface systemic bottlenecks so you can fix the system.
- **Policies over process steps.** Explicit rules beat implicit agreements. Exit criteria gate every transition.
- **Classes of service are first-class.** Expedite, Fixed Date, Standard, and Deferred work flow differently by design.
- **The system signals its own problems.** Nothing should fail silently.

---

## Features

**Board**
- Kanban board with swimlanes by derived class of service
- WIP limits at stage and class level
- Waiting queue split (buffer → active) per stage
- Multi-select bulk transitions and assignments

**Work items**
- Configurable work item types and workflows per organization
- Custom fields (text, number, date, boolean, select, multi-select, URL, user, lookup)
- Intake forms — public no-auth endpoints for external submission
- Parent/child and related item linking
- File and link attachments
- Comment threads with edit/delete

**Flow engine**
- Two-phase transition engine: prepare (evaluate) → execute (commit)
- Three-tier exit criteria: manual checklist, codified conditions, API-verified
- Waiveable criteria with audit trail
- Derived class of service (never user-selected — computed from `is_expedited`, `due_date`, `work_nature`)

**Search**
- JQL (Jira Query Language-compatible) with a PEG grammar compiler
- Natural language → JQL translation via Claude Haiku
- Saved filters
- Full-text search on titles, descriptions, comments, custom fields

**AI**
- Stage playbooks: YAML-frontmatter markdown instructions that execute on stage entry
- Context journal: append-only structured entries per work item (decisions, acceptance criteria, notes, test plans)
- Org context library: org-level knowledge available to all playbook executions
- MCP stdio server: 8 tools for external AI agents to read context, write journal entries, transition items, search, and comment

**Notifications**
- Four delivery channels: in-app, email, webhook, agent
- Exponential backoff with per-channel rate limits
- Webhook ownership challenge (HMAC)

**Audit trail**
- Append-only event log on every work item
- Per-field change expansion on edit events
- Cursor-paginated activity history

---

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js v24 (ESM) |
| API | Express |
| Database | PostgreSQL (source of truth) |
| Frontend | React 18 + Vite + shadcn/ui + Tailwind CSS |
| Auth | express-session + connect-pg-simple |
| AI | Anthropic SDK (Claude Haiku for NL→JQL, configurable model for playbooks) |
| MCP | `@modelcontextprotocol/sdk` stdio transport |

---

## Quick start

```bash
# Start PostgreSQL
docker compose up -d

# Install dependencies
npm install
cd admin-ui && npm install && cd ..

# Copy env and configure
cp .env.example .env
# Edit .env — set GLADIUS_ENCRYPTION_KEY (32-byte hex) and database credentials

# Apply database migrations (creates all tables beyond the base schemas)
npm run db:migrate

# Seed reference data — one org ("My Workspace"), the Feature Development
# workflow, an admin user, and the canonical stage playbooks
npm run seed

# Start the API (port 3000, auto-restart)
npm run dev

# In a separate terminal — start the admin UI (port 5173)
cd admin-ui && npm run dev
```

Admin UI: `http://localhost:5173/admin/`

`npm run seed` also runs any pending migrations automatically, so `npm run seed`
alone works if you want a single command for a fresh database.

Admin login credentials are printed to the console after `npm run seed`.

Want to explore multi-org features instead of the solo starter? Run
`npm run seed:sim` for a 12-org enterprise simulation with sample work items.

---

## Configuration

Copy `.env.example` to `.env`. Key variables:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SESSION_SECRET` | Yes | Express session secret (any random string) |
| `GLADIUS_ENCRYPTION_KEY` | Yes | 32-byte hex key for encrypting AI model API keys |
| `ANTHROPIC_API_KEY` | No | Enables NL→JQL translation and default playbook execution |
| `GLADIUS_AGENT_USER_ID` | No | User ID for MCP server write operations |
| `FLOWOS_MAX_ATTACHMENT_MB` | No | Per-file attachment size limit (default: 25) |

Generate an encryption key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Project structure

```
admin/          Express route handlers
admin-ui/       React frontend (Vite)
api/            Server entry point + auth middleware
core/           Auth, events, storage, URI generation
db/             PostgreSQL connection pool + migrations
mcp/            MCP stdio server
runtime/        Transition engine, search, notifications, AI execution
scripts/        Utilities (search index backfill, etc.)
simulation/     Board simulation tools
tests/          Integration tests (hit the running API)
```

---

## Running tests

Tests are integration tests — they hit the running API directly.

```bash
# Start the API first
npm run dev

# Run all tests
npm test

# Run a single file
node --test tests/workflow-api.test.js
```

---

## MCP server

Gladius OS ships an MCP stdio server for AI agent integration:

```bash
node mcp/gladius-context-server.js
```

Tools: `list_context_entries`, `write_context_entry`, `get_assembled_context`, `list_org_context`, `get_work_item`, `search_work_items`, `transition_work_item`, `add_comment`.

Configure `GLADIUS_AGENT_USER_ID` in `.env` to set the actor identity for write operations.

### Connecting an MCP client (e.g. Claude Code) locally

Put your server definition — including your `GLADIUS_API_KEY` (Bearer token, `fos_ak_` prefix) —
in a project-root `.mcp.json`, **not** in `.claude/settings.json`:

```json
{
  "mcpServers": {
    "gladius": {
      "command": "node",
      "args": ["mcp/gladius-context-server.js"],
      "env": {
        "GLADIUS_API_KEY": "fos_ak_...",
        "GLADIUS_API_BASE_URL": "http://localhost:3000"
      }
    }
  }
}
```

`.mcp.json` is gitignored, so your key never leaves your machine. `.claude/settings.json` is
committed to the repo and shared with the team — it holds permissions, not secrets or MCP
server definitions (Claude Code only reads `mcpServers` from `.mcp.json` or `~/.claude.json`,
never from `.claude/settings.json`). If your key is ever exposed (e.g. pasted into a committed
file or visible in shared session output), rotate it immediately.

---

## Contributing

Gladius OS is early-stage and actively developed. Contributions welcome.

- Open an issue before starting significant work
- Keep PRs focused — one logical change per PR
- All SQL must use parameterized queries — no string interpolation
- New migrations go in `db/migrations/` — never modify applied migrations
- Run `npx eslint .` before opening a PR

---

## License

MIT — see [LICENSE](LICENSE).

Website: [gladius-os.com](https://gladius-os.com)

Maintainer: [Chris Tulino](https://github.com/christulino)
