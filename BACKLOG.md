# BACKLOG — FlowOS

## Active / Up Next

[P1] MCP → REST API refactor (FEAT.25338, **Discovery** on dogfood board — all 5 decisions answered, ready for Planning) — Refactor `mcp/flowos-context-server.js` to call REST API via HTTP. Bearer auth now implemented; move to Planning stage, write planning playbook first (FEAT.25362).

[P1] Data cleanup (DEBT.25359, Backlog on dogfood board) — Remove orphaned seed users/data causing notification subscriber FK violations. PM2 logs flood on every transition event. Investigate `runtime.notifications` + `blueprint.notification_defaults` orphaned rows.

[P1] Decision open/resolved state (FEAT.25360, Todo) — Add `resolved` boolean to `runtime.context_entries`. Required for decision workflow and discovery readiness checks.

[P1] PM2 launchd registration — run the sudo env PATH=... command from `pm2 startup` output to register with launchd. Command: `sudo env PATH=$PATH:/usr/local/bin /Users/chris/.npm-global/lib/node_modules/pm2/bin/pm2 startup launchd -u chris --hp /Users/chris`

[P2] Discovery readiness skill (FEAT.25361, Todo) — Multi-lens review agent that marks a work item "ready" for Planning. Reads journal entries, checks for unresolved decisions, writes a readiness assessment. Exit criteria on Discovery stage gate on the ready flag.

[P2] Planning stage playbook (FEAT.25362, Todo) — Worker briefing document: assembles acceptance criteria, decisions, constraints into a structured brief. Sonnet-class. No code search. Writes one `note` entry titled "Planning Brief."

[P2] Playbooks: external quality check actions (FEAT.25363, Todo) — Allow playbooks to trigger external verify-only actions (PR linkage check, naming convention check). No fix/execution in FlowOS scope; results write back as context entries.

[P2] Bulk ops integration tests (DEBT.25342, Backlog) — `tests/bulk-ops.test.js`; happy path + partial-success. Deferred since Session 26.

[P2] Stage-evidence requirements (FEAT.25343, Backlog) — named attachment slots per stage that gate transitions. Brainstorm before planning.

[P2] Open-source release prep (FEAT.25344, Backlog) — README, LICENSE, seed-and-go experience.

## Done (Session 29 — 2026-06-17)

[done 2026-06-17] feat(auth): Bearer token middleware — async `requireAuth`, `findUserByApiToken`, full Bearer→session fallback chain in `core/auth.js`
[done 2026-06-17] fix(playbookExecutor): code fence stripping (global regex) + `max_tokens` from playbook frontmatter (default 4096)
[done 2026-06-17] feat(dogfood): Feature Discovery playbook written and activated (stage 638, WIT type 138)
[done 2026-06-17] feat(dogfood): FEAT.25338 moved to Discovery; all 5 decisions answered and recorded as journal entries
[done 2026-06-17] chore(dogfood): org context entry documenting 8 MCP tools added to context library
[done 2026-06-17] docs(decisions): FlowOS boundary principle — workflow ownership vs. domain execution [STRATEGY]

## Done (Session 28 — 2026-06-16)

[done 2026-06-16] chore(env): PM2 installed at ~/.npm-global, flowos-api process registered, admin-ui built for static serving
[done 2026-06-16] docs(dogfood): dogfood environment design spec (docs/superpowers/specs/2026-06-15-dogfood-environment-design.md)
[done 2026-06-16] docs(dogfood): dogfood implementation plan (docs/superpowers/plans/2026-06-15-dogfood-environment.md)
[done 2026-06-16] feat(dogfood): scripts/setup-dogfood.js — org, workflow, WIT types, agent user (id:309), 13 org context entries, MCP registration in .claude/settings.json
[done 2026-06-16] feat(dogfood): scripts/load-dogfood-items.js — 15 work items (FEAT.25338–25352, DEBT.25342); MCP refactor in Todo, rest in Backlog

## Done (Session 27 — Context v1)

[done 2026-06-15] feat(context-v1): item journal (runtime.context_entries), org context library (blueprint.org_context), stage playbooks (blueprint.stage_playbooks), AI execution engine (playbookExecutor.js), MCP stdio server (8 tools)

## Done (Sessions 1–26)

See git log for full history. All 7 Tier-1 go-live blockers shipped (auth, notifications, search, attachments, audit trail, bulk ops, form-based intake).
