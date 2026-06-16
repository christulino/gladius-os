# STATE — FlowOS

## Right Now
- **Dogfood environment live.** "FlowOS Development" org (id:109) running locally — 8-stage Kanban, 15 work items loaded, MCP server registered in `.claude/settings.json`. FlowOS now manages its own development.
- FEAT.25338 (MCP → REST API refactor) is in **Todo** — the first item to pull into Discovery. Requires Bearer token auth middleware first.
- PM2 manages the API server (flowos-api). Admin UI built and served at `/admin/`.

## Next Up
1. **Bearer token auth middleware** — implement `Authorization: Bearer fos_ak_...` in `requireAuth`. Required before MCP→REST refactor can start.
2. **Add yourself to flowos-dev org** — Org Center → Members in the running instance.
3. **Bulk ops integration tests** (DEBT.25342) — `tests/bulk-ops.test.js`; happy path + partial-success.

## Blockers
- PM2 launchd registration not yet confirmed (sudo command provided — needs to be run in terminal).
- Bearer token auth unimplemented — blocks MCP→REST refactor (FEAT.25338).

## Last Updated
2026-06-16 — by session-close (tier: Full)
