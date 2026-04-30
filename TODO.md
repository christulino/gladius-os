# FlowOS — TODO

## Flagged Items from Last Session (2026-04-29, Session 22)

Bring up at the start of the next session:

- **Audit trail v1 shipped** (2 commits on `main`, ahead of origin until pushed). New endpoint
  `GET /admin/api/work-items/:id/history`, "Activity" tab on `WorkItemDetail`, 7/7 integration tests green.
- **[P0] Manual browser verification of the Activity tab** — the only unverified piece from Session 22.
  Open the work item drawer in `npm run dev`, click into Activity, verify rendering of created/edited/assigned
  rows and the expand/collapse on field changes. Integration tests cover the API contract; the rendering wasn't
  clicked through.
- **Audit trail v2 candidates** (when ready): event-type filter, search-within-history, diff viewer for long text,
  click-through to spawned children. None required for v1.
- **Carried from Session 21** (still open):
  - Manual smoke tests of all 3 outbound notification channels (webhook, SMTP, agent-channel against real LLM).
  - 3 deferred event types: `work_item.unlinked` (needs DELETE /links), `work_item.comment_edited`,
    `work_item.comment_deleted`. Wire `emitEvent` and add to `HANDLED` set when those endpoints exist.
  - Orphan `runtime.notification_preferences` table — cleanup migration.
  - Missing ESLint config — every subagent flags it; add a config or remove the rule from CLAUDE.md.
- **Open-source release blockers remain**: README, LICENSE, seed-and-go (`docker-compose up` → working board),
  cross-instance service requests. Worth sequencing before the next feature push if going public soon.
- **Agent Collaboration v1 design spec** still queued — bidirectional protocol, context engine, tool-use
  policies, response handling. The notifications agent-channel reservation remains forward-compatible.

## Done (current session)

- [done 2026-04-29] feat(audit-trail): GET /admin/api/work-items/:id/history endpoint
- [done 2026-04-29] feat(audit-trail): Activity tab on WorkItemDetail (new WorkItemHistory.jsx)
- [done 2026-04-29] test: 7-test integration suite for history endpoint
