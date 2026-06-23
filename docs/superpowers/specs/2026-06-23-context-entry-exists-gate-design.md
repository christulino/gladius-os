# context_entry_exists — an agent-passable exit-criteria gate

> Design spec. 2026-06-23. Worktree: `context-entry-exists-gate`.
> Origin: dogfooding the Gladius Feature Development workflow (org 109,
> "Gladius Development") revealed the gate/MCP-surface gap below.

## Problem

The autonomous-feature-pipeline vision depends on exit criteria that block a
transition until the agent has produced sufficient context for the stage. But a
headless agent driving Gladius through the **MCP** can only: read context, write
journal/context entries, transition, comment, search. It has **no tool to set a
field value, acknowledge a criterion, or check a checklist item.**

Meanwhile the existing `codified` condition types (`field_value`,
`child_items_terminal`, `child_stage_class_terminal`, `checklist_complete`) all
gate on things the MCP agent cannot affect. Result: the only gate an MCP agent
can pass is a stage with **no** criteria — exactly the early stages
(Discovery/Planning/Dev-Test) that currently have none. The gating mechanism and
the MCP surface have never met.

## Solution

Add a fifth `codified` condition type, **`context_entry_exists`**, evaluated in
`runtime/exitCriteria.js#evaluateCodified`. It checks
`runtime.context_entries` for at least one entry of a given `type` on the work
item. The agent satisfies it with `write_context_entry` — a tool it already has.
This gates on **work product**, not a checkbox, and a future `api`-tier
LLM-judge can score the same entry.

### Condition shape

```json
{ "type": "context_entry_exists", "entry_type": "discovery", "min_count": 1 }
```

- `entry_type` (required, string): the `context_entries.type` to look for
  (`nfr|discovery|acceptance|design|decision|note|test-plan|playbook`).
- `min_count` (optional, int, default 1): minimum matching entries required.
- Passes when `COUNT(*) >= min_count`; fails otherwise with a clear reason.

### Known v1 limitation

`runtime.context_entries` has **no `stage_id`** column, so the condition cannot
require the entry to have been written *in the current stage* — only that one
exists on the item. Re-entering a stage will not force a fresh entry. Making it
stage-scoped is a follow-up (adds `stage_id` to `context_entries` via migration).
Documented, not silently shipped.

## Gates authored on workflow 138 (Feature Development)

Data rows in `blueprint.exit_criteria`, all `codified`, `is_blocking = true`:

| Stage | Criterion | Condition |
|-------|-----------|-----------|
| Discovery (638) | Discovery write-up exists | `context_entry_exists` `discovery` |
| Discovery (638) | Draft acceptance criteria exist | `context_entry_exists` `acceptance` |
| Planning (639) | Planning Brief exists | `context_entry_exists` `note` |

These mirror what each stage's `on_enter` playbook is told to produce, so the
in-server executor's output satisfies the gate — and the gate blocks if the
executor failed or wrote nothing.

**Why no Dev/Test gate in v1.** Both the Planning and Dev/Test playbooks write
`note` entries, and the v1 condition is not stage-scoped (no `stage_id` on
`context_entries`). A `note exists` gate on Dev/Test would be satisfied by
Planning's note and have no teeth. Dev/Test's real exit is "code done," already
gated downstream by the Review stage's PR-field criteria (`pr_url`,
`pr_status = merged`). A meaningful Dev/Test context gate waits on stage-scoping.

## Sequencing (load-bearing)

**Deploy code before authoring gates.** The evaluating server must already
understand `context_entry_exists`, or a blocking criterion of an unknown type
returns `false` and permanently bricks transitions out of the gated stages for
every item in the org. Order: (1) ship `exitCriteria.js`, (2) restart the API,
(3) run the gate-seed script, (4) run the lap. The seed script is committed but
**not applied** until step 3.

## Playbook naming fix

The 5 playbooks (stages 638–642) still say "FlowOS" and `$FLOWOS_API_KEY`.
Update to "Gladius" / `$GLADIUS_API_KEY` while authoring the gates. Text-only; no
behavior change.

## Test plan

`tests/exit-criteria-context-entry.test.js` (node:test, runs against the DB via
`db/postgres.js` — no HTTP server needed, unlike the HTTP integration suite,
because `evaluateExitCriteria` queries the DB directly):

1. Create a temp work item; add a temp `context_entry_exists` criterion on its
   stage. Assert `evaluateExitCriteria` **fails** (no entry yet).
2. Write a matching context entry. Assert it **passes**.
3. `min_count: 2` with one entry present → fails; with two → passes.
4. Wrong `entry_type` present → still fails.
5. Teardown removes temp rows.

## Out of scope (filed as follow-ups, not done here)

- Stage-scoped entries (`stage_id` on `context_entries`).
- LLM-judge `api`-tier scoring of the entry.
- MCP tools for field-setting / criterion-ack (Review/Deployment still rely on
  `curl` + bearer token — a separate, larger gap).
