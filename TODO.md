# FlowOS — TODO

## Flagged Items from Last Session (2026-04-16, Session 20)

Bring up at the start of the next session:

- **Event system shipped, merged to main (`ff5cdaa`).** Production-ready for FlowOS's target scale. Two subscribers live: `neo4j-sync` and `audit-log`. Admin UI at `/admin/events`.
- **Test file split done** (Session 21) — `tests/events-processor.test.js` (no-server) and `tests/events-integration.test.js` (server-running). 16/16 processor assertions pass.
- **Next Phase 2 candidates** — Search & saved filters, Notifications (now unblocked by events), Attachments, Audit trail UI per work item. Pick one to focus the next session.
- **Open-source release blockers remain** — Cross-instance service requests, seed-and-go experience (`docker-compose up` → working board), README + LICENSE. Worth sequencing before the next feature push.
