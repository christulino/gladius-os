# BACKLOG — FlowOS

## Active / Up Next

[P0] Bearer token auth middleware — implement `Authorization: Bearer fos_ak_...` support in `requireAuth` (core/auth.js + api/server.js). Required for MCP→REST refactor (FEAT.25338). Look up user by `api_token`, set `req.userId` same as session auth.

[P1] MCP → REST API refactor (FEAT.25338, Todo on dogfood board) — depends on Bearer token auth above. Refactor `mcp/flowos-context-server.js` to call REST API via HTTP instead of direct PostgreSQL.

[P1] Add yourself to flowos-dev org — log in at http://localhost:3000/admin/, Org Center → Members, add your user to "FlowOS Development."

[P1] PM2 launchd registration — run the sudo env PATH=... command from `pm2 startup` output to register with launchd. Command: `sudo env PATH=$PATH:/usr/local/bin /Users/chris/.npm-global/lib/node_modules/pm2/bin/pm2 startup launchd -u chris --hp /Users/chris`

[P2] Bulk ops integration tests (DEBT.25342, Backlog) — `tests/bulk-ops.test.js`; happy path + partial-success. Deferred since Session 26.

[P2] Stage-evidence requirements (FEAT.25343, Backlog) — named attachment slots per stage that gate transitions. Brainstorm before planning.

[P2] Open-source release prep (FEAT.25344, Backlog) — README, LICENSE, seed-and-go experience.

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
