# STATE — Gladius

## Right Now
- **FEAT.25454 (search sort/date NL support) — SHIPPED & merged to `main`.** `sort_by`, `sort_dir`, `created_after`, `created_before` wired through translator → search endpoint. Code-fence stripping added to `extractText()` (Haiku wraps JSON in fences despite instructions). `type_name` gap in frontend `searchApi.query()` fixed as a bonus. "The oldest features" → sorted Feature list; "items from last week" → date-filtered list. Commit: 9a4a772.

## Next Up
1. **Agent author_id fix [P2]** — executor and MCP `write_context_entry` write entries with `author_id=NULL`. Fix write path to use agent user (id 309). Unblocks non-admin Workers from edit/delete on agent entries.
2. **Raise max_tokens [P2]** — Dev/Test/Review/Deployment stages still 1024–1536. Planning fixed (8192). Raise rest to ≥8192 (default already updated in executor, but live DB playbook records need update).
3. **FEAT.25338 [P1]** — MCP → REST API refactor. All 5 decisions answered in Discovery, ready for Planning.

## Blockers
- (carry-over) npm `gladius` squat; parchment-vs-neutral theme decision still open.

## Last Updated
2026-06-23 — Session 36 (FEAT.25454 search sort/date shipped; Haiku code-fence bug found+fixed)
