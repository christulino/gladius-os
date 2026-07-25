# Gladius

**The gate-and-memory layer for AI-assisted work.**

Give your AI agents exit criteria they can't skip and a context journal they read and write — so the work they do gets **gated, remembered, and auditable.** Built on Kanban flow. Self-hosted, not SaaS. MIT licensed.

[Install](#install-docker) · [Quickstart](docs/quickstart.md) · [Connect an agent](#connect-an-ai-agent-mcp)

---

## Why this exists

AI agents now do real work — writing code, triaging issues, moving tickets. But nothing *gates* that work or *remembers* it. Items get marked "done" with no evidence they're done. The context an agent needs — decisions, acceptance criteria, prior reasoning — lives in a chat window and dies with the session.

Gladius is the missing layer. It holds the work, enforces the criteria each stage requires before an item can advance, and keeps a durable, structured memory that agents and humans read from and write back to. The agent executes; Gladius frames and gates.

---

## How it works

Three primitives do the work.

### Exit-criteria gates

Every transition runs through a two-phase engine — *prepare* (evaluate the gate) then *execute* (commit the move). A stage's **exit criteria** must pass before an item can leave it. Criteria come in two tiers: **manual** checklists a human or agent acks, and **codified** conditions the system evaluates itself (e.g. "a test-plan entry exists," "the PR link is set"). Criteria are waiveable, with the waiver recorded in the audit trail. The worker can't skip a gate — the board won't let the work advance until the stage's contract is met.

### Context journal + org library

Each work item carries an append-only **journal** of typed entries — discovery notes, acceptance criteria, design, decisions, test plans. At the org level, a **context library** holds shared knowledge — team agreements, conventions, doctrine. Both are readable and writable over the REST API and MCP, so an agent picks up exactly the context a task needs and writes its reasoning back for the next one. Memory that outlives the session.

### Playbooks + MCP

**Stage playbooks** are YAML-frontmatter markdown that execute automatically when an item enters a stage — pulling the journal and org context they declare, calling a configured model, and writing structured entries back. External agents drive Gladius directly through the **MCP stdio server (19 tools)**: read assembled context, write journal entries, transition items, ack exit criteria, search, comment, resolve decisions, and more.

---

## Install (Docker)

You need Docker with Compose. Two commands, under 5 minutes, no file editing:

```bash
curl -O https://raw.githubusercontent.com/christulino/gladius-os/main/docker-compose.yml
docker compose up
```

Then open **http://localhost:3000/admin/**. On first boot the app generates a
random admin password and prints it in the container logs:

```bash
docker compose logs app | grep -A1 "Admin password"
```

Log in with `admin@example.com` and that password, then change it under
**Settings → Profile**.

**AI features (optional):** playbooks and natural-language search stay dark until
you add an Anthropic API key under **Settings → AI Models**. No environment
editing required — the board works immediately without it.

**Reset everything** (destroys all data and regenerates secrets):

```bash
docker compose down -v
```

**Known limitations (v1):** the published image is `linux/amd64` only; on Apple
Silicon it runs under emulation. Multi-arch images are planned.

> **New here?** After installing, follow the [Quickstart](docs/quickstart.md) — in
> about 10 minutes you'll watch a stage gate refuse to let an unfinished item
> advance until its criteria are met.

---

## Connect an AI agent (MCP)

Gladius ships an MCP stdio server so an external agent can read context, write journal entries, transition work, and satisfy gates — all over the same rules a human hits.

```bash
node mcp/gladius-context-server.js
```

Point an MCP client (e.g. Claude Code) at it with a project-root `.mcp.json` — including your `GLADIUS_API_KEY` (Bearer token, `fos_ak_` prefix):

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

The server exposes **19 tools** — context (`get_assembled_context`, `list_context_entries`, `write_context_entry`, `list_org_context`, `write_org_context`), work (`get_work_item`, `search_work_items`, `set_work_item_fields`, `add_comment`, `link_work_items`, `unlink_work_items`), flow (`get_available_transitions`, `transition_work_item`, `get_exit_criteria`, `ack_exit_criterion`, `get_stage_playbook`, `get_session_context`), and decisions (`resolve_decision`, `reopen_decision`). Set `GLADIUS_AGENT_USER_ID` in `.env` to set the actor identity for writes.

**Keep secrets out of the repo.** `.mcp.json` is gitignored, so your key never leaves your machine. `.claude/settings.json` is committed and shared — it holds permissions, not secrets or MCP server definitions (Claude Code only reads `mcpServers` from `.mcp.json` or `~/.claude.json`). If a key is ever exposed, rotate it immediately.

---

## Built on Kanban flow

Gladius isn't an AI wrapper bolted onto a task list. Its primitives come from Lean and the Kanban Method — Taiichi Ohno's Toyota Production System, David Anderson's Kanban Method, and Patrick Burrows' work on flow — because those are the right primitives for governing work, whether a human or an agent does it:

- **Pull, don't push.** Work moves when downstream capacity exists, not when upstream decides to push it.
- **WIP limits expose problems.** They don't prevent work — they surface systemic bottlenecks so you can fix the system.
- **Policies over process steps.** Explicit rules beat implicit agreements. Exit criteria gate every transition — the same gates your agents run into.
- **The system signals its own problems.** Nothing should fail silently.

The board is a health monitor, not a status tracker. You watch the work move, not the people — or agents — doing it.

---

## Everything else it does

Beyond the gates, memory, and MCP surface, Gladius is a complete work-tracking substrate:

**Board**
- Kanban board with stage-based columns and per-stage WIP limits
- Multi-select bulk transitions and assignments

**Work items**
- Configurable work item types and workflows per organization
- Custom fields (five types: text, number, date, select, multi-select)
- Parent/child and related-item linking
- Link attachments
- Comment threads with edit/delete

**Search**
- Natural language → structured-filter translation via Claude Haiku
- Saved filters
- Full-text search across titles, descriptions, comments, and custom fields

**Notifications**
- Two delivery channels: in-app and agent
- Exponential backoff with rate limits on agent delivery

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
| AI | Anthropic SDK (Claude Haiku for NL→structured-filter search, configurable model for playbooks) |
| MCP | `@modelcontextprotocol/sdk` stdio transport |

---

## Quick start (from source)

```bash
# Start PostgreSQL for local development
docker compose -f docker-compose.dev.yml up -d

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
alone works if you want a single command for a fresh database. Admin login
credentials are printed to the console after `npm run seed`.

Want to explore multi-org features instead of the solo starter? Run
`npm run seed:sim` for a 12-org enterprise simulation with sample work items.

---

## Configuration

Copy `.env.example` to `.env`. Key variables:

| Variable | Required | Description |
|---|---|---|
| `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | Yes | PostgreSQL connection (the Docker install sets these for you) |
| `SESSION_SECRET` | Yes | Session secret — at least 32 random characters (auto-generated by the Docker install) |
| `GLADIUS_ENCRYPTION_KEY` | Yes | 32-byte hex key for encrypting AI model API keys (auto-generated by the Docker install) |
| `ANTHROPIC_API_KEY` | No | Enables NL→structured-filter search and playbook execution |
| `GLADIUS_AGENT_USER_ID` | No | User ID for MCP server write operations |

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
core/           Auth, events, CORS, secrets, URI generation
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

## API documentation

The full REST API is documented in [`docs/rest-api-reference.md`](docs/rest-api-reference.md) — base path, auth (session cookie vs. Bearer API token), and every endpoint group with request/response shapes for the most-used routes.

Stage playbook YAML frontmatter (`trigger`, `model`, `context.pull`/`context.org`/`context.write`, and execution lifecycle) is documented in [`docs/playbook-format.md`](docs/playbook-format.md).

The actor/terminology model (Gladius / Executor / Worker / Headless Worker / Orchestrator / Maintainer / Architect) and how playbooks reach a Worker are documented in [`docs/architecture.md`](docs/architecture.md).

---

## Contributing

Gladius is early-stage and actively developed. Contributions welcome.

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
