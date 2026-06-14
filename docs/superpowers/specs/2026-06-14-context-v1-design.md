# FlowOS Context v1 — Design Spec

> Status: Approved  
> Session: 27 (2026-06-14)  
> Author: Chris Tulino + Claude  
> Build approach: Walking skeleton — prove one full slice end-to-end, then expand

---

## 1. What This Is

Context v1 makes FlowOS AI-native. Work items accumulate structured knowledge as they move through a workflow. That knowledge fuels AI actions at each stage. Agents and humans work on the same items through the same system.

The core primitive is the **context entry** — a typed, authored, editable markdown document attached to a work item or org. Entries accumulate as work progresses. Stages have **playbooks** that define what an AI agent should do when a work item arrives, what context to pull, and what to write back. An **MCP server** exposes every atomic action so external agents (Claude in an IDE, Cursor, etc.) can interact with FlowOS directly.

This is not a bolt-on AI feature. It is a rearchitecting of how work carries knowledge through a system.

---

## 2. Three Tiers of Context

```
Org Context Library         ← background knowledge, always available to agents
└── Epic Journal            ← visibility:descendants flows down
    └── Feature Journal     ← visibility:descendants flows down
        └── Story Journal   ← item-local + inherited entries
            └── Stage Playbook assembles:
                [org context by type] + [ancestor context by type] + [item context]
                → AI action
                → AI writes back a new journal entry
```

### Tier 1 — Item Journal
Append-style context entries on a work item. Editable with edit tracking. Typed, tagged, authored (user or agent). Entries with `visibility: descendants` flow down to all child items via traversal query.

### Tier 2 — Ancestral Context Traversal
FlowOS assembles the context bundle — the agent doesn't traverse. Query: all entries of requested types on this item and its ancestors where `visibility = 'descendants'`, ordered by depth (closest first).

### Tier 3 — Org Context Library
Admin-curated background knowledge scoped to the org. Same schema as item journal entries. Injected into every playbook execution as the baseline system context. Agents always know the org's architecture, standards, domain vocabulary, and working agreements.

---

## 3. Data Model

### `runtime.context_entries`
```sql
id              SERIAL PRIMARY KEY
work_item_id    INTEGER REFERENCES runtime.work_items(id) ON DELETE CASCADE
type            TEXT NOT NULL  -- nfr | discovery | design | acceptance | playbook | decision | note | ...
title           TEXT
content         TEXT NOT NULL  -- markdown
visibility      TEXT NOT NULL DEFAULT 'item'  -- 'item' | 'descendants'
tags            TEXT[] DEFAULT '{}'
author_id       INTEGER REFERENCES blueprint.users(id)
is_agent        BOOLEAN NOT NULL DEFAULT false
is_edited       BOOLEAN NOT NULL DEFAULT false
created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
```

### `blueprint.org_context`
```sql
id              SERIAL PRIMARY KEY
org_id          INTEGER REFERENCES blueprint.organizations(id) ON DELETE CASCADE
type            TEXT NOT NULL  -- architecture | standards | security | domain | working-agreements | ...
title           TEXT NOT NULL
content         TEXT NOT NULL  -- markdown
tags            TEXT[] DEFAULT '{}'
author_id       INTEGER REFERENCES blueprint.users(id)
is_edited       BOOLEAN NOT NULL DEFAULT false
created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
```

### `blueprint.stage_playbooks`
```sql
id              SERIAL PRIMARY KEY
stage_id        INTEGER REFERENCES blueprint.stages(id) ON DELETE CASCADE  -- nullable
wit_type_id     INTEGER REFERENCES blueprint.work_item_types(id) ON DELETE CASCADE  -- nullable
-- stage_id takes precedence; wit_type_id is the fallback default
-- both nullable allows org-level defaults in a future iteration
name            TEXT NOT NULL
content         TEXT NOT NULL  -- full markdown with YAML frontmatter
is_active       BOOLEAN NOT NULL DEFAULT true
created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
```

### `blueprint.org_ai_models`
```sql
id              SERIAL PRIMARY KEY
org_id          INTEGER REFERENCES blueprint.organizations(id) ON DELETE CASCADE
name            TEXT NOT NULL  -- 'default' | 'fast' | 'code-review' | 'acceptance' | ...
provider        TEXT NOT NULL DEFAULT 'anthropic'  -- anthropic | openai
model           TEXT NOT NULL
api_key_enc     TEXT  -- encrypted at rest; nullable if reusing org default key
is_active       BOOLEAN NOT NULL DEFAULT true
created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
UNIQUE(org_id, name)
```

`name = 'default'` is required for an org to run any playbook. Named models beyond that are optional and referenced by name in playbook frontmatter.

---

## 4. Context Entry Frontmatter Schema

Entries are authored in markdown. Frontmatter is YAML. The schema is identical for item journal entries and org context entries.

```yaml
---
type: nfr                    # required — controls filtering and traversal
title: Latency requirements  # optional short label
visibility: descendants      # 'item' (default) | 'descendants'
tags: [performance, sla]     # optional — for filtering
---

Content here in markdown. Tables, code blocks, lists, GWT scenarios — all supported.
Rendered in the UI with full markdown rendering. Edited as raw source with Preview toggle.
```

---

## 5. Stage Playbooks

### Format
Playbooks are markdown files stored in the database (`blueprint.stage_playbooks.content`). The frontmatter is for FlowOS (what to assemble, what model to use, what the agent may write back). The body is for the agent (natural language instructions).

```markdown
---
name: story-refinement
trigger: on_enter            # on_enter | on_exit | manual
model: fast                  # references blueprint.org_ai_models.name
context:
  pull:
    - type: discovery
      traverse: ancestors    # include matching entries from parent items
    - type: nfr
      traverse: ancestors
    - type: acceptance
      traverse: ancestors    # avoid duplicating work from parent features
  org: [architecture, domain]  # org context types to inject
  write: [acceptance, note]    # entry types this playbook is permitted to write back
---

## Goal
Review discovery notes and produce testable acceptance criteria.

## Steps
1. Read all discovery context. Note ambiguities or gaps.
2. Check NFR entries from parent items for performance, security, or compliance constraints.
3. Write acceptance criteria in Given/When/Then format.
4. If requirements are unclear, write a `note` entry flagging the gap — do not invent requirements.

## Quality Bar
- Each criterion must be independently testable
- Cover happy path, error cases, and edge cases
- If more than 10 criteria are needed, flag the story for splitting
```

### Inheritance
When a work item enters a stage, FlowOS resolves the playbook in this order:
1. Active playbook on the specific stage (`stage_id`)
2. Active playbook on the work item's WIT type (`wit_type_id`)
3. No playbook — no AI action triggered

### Trigger
- `on_enter` — fires when a work item transitions into this stage
- `on_exit` — fires when a work item transitions out (e.g., pre-flight checks)
- `manual` — only fires when explicitly triggered by a user or agent via API

### Playbook Editor
Lives in Workflow Manager → Stage edit view. Raw markdown editor (frontmatter + body in one surface). Features:
- YAML frontmatter key autocomplete (trigger, model, context, write)
- Model names pulled from `org_ai_models` and offered as completions
- Context types autocomplete from known types
- Validation on save — clear error if a key is invalid or model name doesn't exist
- "Start from template" inserts a complete skeleton playbook
- Preview/Edit toggle (rendered markdown vs. raw source)
- **AI Assistant panel** — split right-side panel using the org's `default` AI model (from `org_ai_models`). Pre-loaded with FlowOS schema, current playbook content, org model list, and available context types. Quick actions: "Check playbook", "Improve steps", "Show example". Agent can propose edits and apply them directly to the editor. User saves when satisfied. If no `default` model is configured, the panel shows a prompt to configure one in AI Models settings.

---

## 6. Context Assembly

When a playbook fires (on_enter, on_exit, or manual), FlowOS assembles the context bundle before calling the AI:

```
1. Org context    — SELECT * FROM blueprint.org_context
                    WHERE org_id = $org_id
                      AND type = ANY($org_types)   -- from playbook frontmatter: org: [architecture, domain]
                    ORDER BY type, created_at

2. Ancestor ctx   — WITH RECURSIVE ancestors(id, depth) AS (
                      SELECT parent_id, 1 FROM runtime.work_items WHERE id = $item_id
                      UNION ALL
                      SELECT wi.parent_id, a.depth + 1
                      FROM runtime.work_items wi JOIN ancestors a ON wi.id = a.id
                      WHERE wi.parent_id IS NOT NULL
                    )
                    SELECT ce.*, a.depth FROM runtime.context_entries ce
                    JOIN ancestors a ON ce.work_item_id = a.id
                    WHERE ce.type = ANY($pull_types)  -- from playbook frontmatter: pull: [{type, traverse}]
                      AND ce.visibility = 'descendants'
                    ORDER BY a.depth ASC, ce.created_at ASC

3. Item ctx       — SELECT * FROM runtime.context_entries
                    WHERE work_item_id = $item_id
                      AND type = ANY($pull_types)
                    ORDER BY created_at ASC

4. Playbook body  — the markdown instructions from stage_playbooks.content (body only, frontmatter stripped)
```

The assembled bundle is passed to the AI as the user message. The org context is injected as the system prompt prefix. The agent reads everything; FlowOS controls what gets written back via the `write` allowlist in the frontmatter. Entries of types not in the `write` list are silently dropped — the agent cannot write outside its permitted scope.

---

## 7. Playbook Execution — Two Modes

### Internal Mode (org API key configured)
1. Work item enters a stage → FlowOS resolves playbook → assembles context bundle
2. Calls the configured AI provider using `org_ai_models` (provider, model, encrypted key)
3. AI response is parsed — only `write`-allowed entry types are accepted
4. New context entries written back to `runtime.context_entries` with `is_agent: true`
5. Events emitted: `work_item.context_entry_added` (new event type — add to event catalog and notification subscriber)

### External Mode (MCP)
External agents (Claude in IDE, Cursor, custom agents) connect via the FlowOS MCP server. They can:
- Read any work item's journal via `get_context()`
- Manually trigger a playbook via `run_playbook()`
- Write context entries directly via `add_context_entry()`
- Take any other atomic action (transition, comment, assign, etc.)

Both modes use the same data model and permission system. Agents are users (`is_agent: true` on `blueprint.users`).

---

## 8. MCP Server

FlowOS exposes an MCP server as the inbound agent interface. Every atomic action available to human users is exposed as an MCP tool.

### Tool List (v1)
```
get_work_item(id)
create_work_item(org_id, type_id, title, ...)
transition(work_item_id, target_stage_id)
add_context_entry(work_item_id, type, content, visibility?, tags?)
get_context(work_item_id, types?, traverse?)
update_context_entry(entry_id, content)
add_comment(work_item_id, content)
assign(work_item_id, user_id, relationship_type)
search(jql)
get_playbook(stage_id)
run_playbook(work_item_id, stage_id)  -- runs the playbook for that stage against this item; item need not currently be in that stage
create_child(parent_id, type_id, title, ...)
get_org_context(org_id, types?)
list_stages(workflow_id)
list_work_item_types(org_id)
```

### System Prompt
The MCP server ships with a system prompt that teaches the agent the FlowOS mental model:
- Work moves through stages; transitions are gated by exit criteria
- Context accumulates as journal entries; `visibility: descendants` flows to child items
- Use `get_context()` before acting on any item — don't assume what context exists
- Use `search(jql)` to find related work
- Prefer `add_context_entry()` over `add_comment()` when writing something another agent will need to read
- The `write` allowlist in a playbook controls what entry types can be written back

---

## 9. UI

### Journal Tab (WorkItemDetail)
- Dedicated **Journal** tab alongside Details, Comments, Activity
- Type filter pills at the top (All, NFR, Discovery, Acceptance, ...)
- Entries sorted newest-first; inherited entries (from ancestors) shown slightly muted with `↑ from PARENT-KEY` label
- Agent-written entries flagged with `🤖 agent` badge; edited entries show "edited" in amber
- Each entry renders full markdown by default (tables, code blocks, GWT scenarios, lists)
- Click **Edit** → raw markdown editor with Preview/Edit toggle, Save/Cancel footer
- `visibility: descendants` shown as a badge on entries that flow to child items
- **+ Add Entry** button → inline form: type selector, optional title, visibility selector, markdown editor

### Org Context Library (Org Center)
- New section in Org Center sidebar: **Context Library**
- Accordion list of entries, collapsed by default, click to expand and read full markdown
- Type filter pills; **+ Add Entry** button (admins only)
- Edit/delete inline per entry
- Companion section in Org Center sidebar: **AI Models** — configure named models (name, provider, model ID, API key)

### Playbook Editor (Workflow Manager)
- Tab on Stage edit view: **Details** | **Playbook**
- Full raw markdown editor — frontmatter + body as one surface
- Schema-aware: autocomplete for keys, model names, context types; validation on save
- "Start from template" inserts skeleton playbook
- Preview/Edit toggle
- Active/inactive toggle with green indicator
- **AI Assistant panel** — right-side split, ~240px wide
  - Context badges showing what the agent knows
  - Quick actions: Check playbook, Improve steps, Show example
  - Chat interface with apply-suggestion button for direct editor edits

---

## 10. Walking Skeleton — First Slice

Build this sequence to prove the full system works before expanding:

### Slice: Story Refinement on "In Development"
1. **Migration 017** — add all four tables
2. **API endpoints** — CRUD for context_entries + org_context + stage_playbooks + org_ai_models
3. **Journal tab** — read + add entry on WorkItemDetail (no traversal yet)
4. **AI Models config** — Org Center page to add a `default` and `fast` model
5. **Playbook editor** — Stage edit view with raw markdown editor + AI assistant panel
6. **Context assembly** — traversal query pulling from ancestors by type
7. **Internal executor** — on_enter trigger → assemble bundle → call AI → write back entries
8. **MCP server** — thin wrapper over existing API + context tools + system prompt

At the end of this slice: a work item entering "In Development" automatically gets AI-generated acceptance criteria written to its Journal tab, pulled from discovery notes on the parent feature, informed by the org's architecture and domain context. An external agent can also trigger this manually via MCP.

---

## 11. Out of Scope for v1

- **Playbook compilation** — markdown → efficient compiled code paths. v1 always calls the AI; compilation is a performance optimization for v2.
- **S3/MinIO storage** for context entries (they're text, not files — not needed)
- **Event-type filtering** in the Journal tab (type pills handle this)
- **Promote from item to org** — promoting a journal entry to the Org Context Library. Manual curation only in v1.
- **Sub-playbooks / playbook composition** — one playbook per stage per WIT type in v1
- **Per-step model selection within a playbook** — one model per playbook (named in frontmatter)
- **SAML/OIDC for agents** — API keys are sufficient for v1 agent auth
- **Playbook version history** — `updated_at` timestamp only; full version history is v2
- **API key encryption implementation** — implementation detail deferred to build; use AES-256-GCM with key from env var (`FLOWOS_ENCRYPTION_KEY`)
