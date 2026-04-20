# FlowOS — TODO

## Flagged Items from Last Session (2026-04-20, Session 21)

Bring up at the start of the next session:

- **Notifications v1 shipped** (22 commits on `main`). Plan + spec in `docs/superpowers/{plans,specs}/2026-04-20-notifications*.md`. 40/40 unit tests + 3/3 integration tests green.
- **Manual smoke tests not yet performed.** Verify in a follow-up: (1) webhook end-to-end against a real URL with valid ownership challenge, (2) email via SMTP, (3) agent-channel envelope against an actual LLM endpoint.
- **Next Phase 2 candidate** — recommended: **Audit Trail UI per work item** (small, leverages `runtime.work_item_edits` already populated by Session 20). Alternatives: Search & saved filters (biggest user-demanded gap, multi-session), Attachments (XL — needs S3/MinIO).
- **Session debt discovered**:
  - Orphan `runtime.notification_preferences` table from earlier experiment (empty, unused). Candidate for cleanup migration.
  - Missing ESLint config project-wide — CLAUDE.md says "run `npx eslint .` before declaring done" but the command fails with "no config file." Add a minimal `.eslintrc.json` or remove the rule.
  - MEMORY.md drift: claimed `blueprint.users` had an `auth_provider` column — it does not. Corrected in memory.
- **Three notification event types deferred** pending emission sites: `work_item.unlinked` (needs DELETE /links endpoint), `work_item.comment_edited`, `work_item.comment_deleted`. Wire up when those endpoints exist.
- **Open-source release blockers remain**: README, LICENSE, seed-and-go (`docker-compose up` → working board), cross-instance service requests. Worth sequencing before the next feature push if going public soon.
- **Agent Collaboration v1 design spec** queued — bidirectional protocol, context engine, tool-use policies, response handling. The notifications agent-channel reservation is forward-compatible.
