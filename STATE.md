# STATE — FlowOS

## Right Now
- **FEAT.25338 (MCP → REST refactor) in Discovery** — all 5 decisions answered and recorded in item journal. Ready to move to Planning stage. Planning playbook (FEAT.25362) should be written before or when the item enters Planning.
- **Bearer token auth shipped** — `requireAuth` now accepts `Authorization: Bearer fos_ak_...` in addition to session cookies. MCP → REST refactor's first dependency is unblocked.
- **Notification crash loop active** — DEBT.25359 (orphaned seed data causing FK violations in notification subscriber). PM2 logs flood on every transition but functionality is intact.

## Next Up
1. **Move FEAT.25338 to Planning** — transition on dogfood board. Write planning playbook (FEAT.25362) first so it fires on entry.
2. **DEBT.25359** — Data cleanup: orphaned seed users/data causing notification subscriber crashes. Investigate `runtime.notifications` FK violations.
3. **FEAT.25360** — Decision open/resolved state: add `resolved` boolean to `runtime.context_entries`. Unblocks discovery readiness skill (FEAT.25361).

## Blockers
- PM2 launchd registration not yet confirmed (sudo command in BACKLOG — needs to be run in terminal).

## Last Updated
2026-06-17 — by session-close (tier: Full)
