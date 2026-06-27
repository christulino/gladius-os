# Team Agreements

> Umbrella term: **Team Agreements** — used as the `type` field for org context entries.
>
> This document records the operating model decisions made in FEAT.25506: what went
> in-system (Gladius primitives) and what stayed as a doc, and why.

## What lives in Gladius (in-system)

These are seeded into every fresh install via `npm run seed:solo` and belong in the
"My Workspace" org context library under type `team-agreement`.

| Title | Why in-system |
|-------|---------------|
| Branch Naming Convention | Agents need this to propose branch names from the Dev/Test stage playbook |
| PR Description Format | The Review stage playbook reads this to draft conformant PR descriptions |
| Commit Message Convention | Injected into agent prompts for any commit-producing action |
| Test-Coverage Policy | Gates the Dev/Test → Review transition via the "test plan documented" exit criterion |
| Definition of Done | Shared context for both humans and agents on what "done" actually means |

**Exit criteria gates** (codified, blocking):
- `Dev/Test` stage: "Test plan documented" — requires at least one `test-plan` journal entry before moving to Review
- `Review` stage: "PR link required" — requires the `pr_url` field to be set before approving to Done

**Stage playbooks** (require an AI model configured):
- `Discovery`: Frame the Problem — frames the discovery note and drafts acceptance criteria
- `Planning`: Design & Task Breakdown — drafts design entry and implementation checklist
- `Review`: Draft PR Description — drafts a conformant PR description from journal + team agreements

## What stayed as a doc (this file) and why

The following did not become org context entries:

**CLAUDE.md** — architecture decisions, tech stack, and project-specific coding rules.
This stays in the repo because it is version-controlled alongside the code it describes,
not environment-specific, and far too large to inject into every agent prompt without
burning context budget. Agents reference it at session start, not mid-task.

**DECISIONS.md** — historical architectural choices with full rationale.
These are retrospective records, not execution knowledge. Injecting them into every
agent prompt would add noise without value; an agent can pull specific decisions via
the `list_context_entries` MCP tool on the relevant work item.

**ARCHITECTURE.md** — database schema, core model, what's built vs. planned.
Reference documentation, not execution context. Same rationale as DECISIONS.md.

**CONTRIBUTING.md (does not exist yet)** — contributor onboarding for external contributors.
Deferred until the open-source release gate is cleared. When it exists, it will
reference this file and CLAUDE.md rather than duplicate them.

## Principle guiding these choices

From the discovery decision journal entry (FEAT.25506, id 140):

> Default a new agreement to org context; promote it to an exit criterion only when
> enforcement is genuinely needed.

Concretely: an agreement becomes an org context entry when agents need it as
execution knowledge. It becomes an exit criterion only when violation would cause
a real downstream failure (missing PR link blocks the merge; missing test plan
means the reviewer can't verify the change). Everything else stays as a doc.
