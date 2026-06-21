# Gladius

An open source work operating system built on Kanban and Lean principles.

**Self-hosted. Not SaaS. MIT licensed.**

Gladius treats work as a flow system — the board is a health monitor, not a status tracker. Watch the work move, not the people doing it.

---

## What it is

- Kanban-native board with WIP limits, waiting queues, and derived classes of service
- AI-native: stage playbooks trigger on transitions, write structured journal entries, assemble context for agents
- MCP server for external AI agents to read and write work items
- JQL search with natural-language translation
- Webhook/email/agent notification delivery
- Extensible via custom fields, intake forms, and a programmable exit criteria engine

## What it is not

- Not a task list app
- Not SaaS — you run it
- Not a people tracker

---

## Quick start

```bash
# Start PostgreSQL + Neo4j
docker compose up -d

# Install dependencies
npm install
cd admin-ui && npm install && cd ..

# Run migrations + seed
npm run seed

# Start the API
npm run dev

# In a separate terminal, start the admin UI
cd admin-ui && npm run dev
```

Admin UI: http://localhost:5173/admin/

---

## Requirements

- Node.js v24+
- Docker (for PostgreSQL + Neo4j)
- An Anthropic API key (for AI features — optional to get started)

---

## Project

- Website: [gladius.tools](https://gladius.tools) *(coming soon)*
- License: MIT
- Maintainer: Chris Tulino
