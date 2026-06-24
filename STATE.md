# STATE — Gladius

## Right Now
- **Session 36 closed.** FEAT.25454 (search sort/date NL support) + FEAT.25361 (Discovery readiness gate: `no_unresolved_decisions` codified exit criterion) + session-start live board read — all shipped and pushed. CLAUDE.md staleness fixed (NL→JQL references updated).

## Next Up
1. **FEAT.25338 [P1]** — MCP → REST API refactor. All 5 Discovery decisions answered, ready for Planning. Write planning playbook (FEAT.25362) first.
2. **Agent author_id fix [P2]** — executor and MCP `write_context_entry` write entries with `author_id=NULL`. Fix write path to use agent user (id 309). Unblocks non-admin Workers from edit/delete on agent entries.
3. **Raise max_tokens [P2]** — Dev/Test/Review/Deployment stages still 1024–1536 in live DB. Planning fixed (8192). Raise rest to ≥8192.

## Blockers
- (carry-over) npm `gladius` squat; parchment-vs-neutral theme decision still open.

## Last Updated
2026-06-23 — session-close (tier: Full — FEAT.25454 + FEAT.25361, 4 commits)
