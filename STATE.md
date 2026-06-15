# STATE — FlowOS

## Right Now
- Session 27 complete. **Context v1 shipped** — item journal, org context library, stage playbooks, AI execution engine (post-transition hook → Anthropic SDK → write-back), MCP stdio server with 8 tools.
- Migration 017, 17 new runtime/blueprint files, 6 new React components, ~100 API endpoints total.
- All 7 Tier-1 blockers still DONE. Context v1 is Tier 3 #24 (Differentiator).

## Next Up
1. **Bulk ops integration tests** — `tests/bulk-ops.test.js` (deferred since Session 26); happy path + partial-success case.
2. **Stage-evidence requirements** — per-stage named attachment slots ("Permit to Operate") that gate transitions. Brainstorm before planning.
3. **Open-source release prep** — README, LICENSE, seed-and-go (`docker-compose up` → working board), cross-instance service requests.

## Blockers
- `FLOWOS_ENCRYPTION_KEY` (32-byte hex) and `FLOWOS_AGENT_USER_ID` must be set in `.env` for Context v1 features to work. Not blockers for dev, but required before any org can configure AI models or run the MCP server.

## Last Updated
2026-06-15 — by session-close (tier: Full)
