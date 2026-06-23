# STATE — Gladius

## Right Now
- **FEAT.25361 (Discovery readiness gate) + session-start board read — SHIPPED.** New `no_unresolved_decisions` codified condition type in `exitCriteria.js`; added as 3rd exit criterion to dogfood Discovery stage (existing gates: discovery entry + acceptance entry). Session-start skill updated with Step 1.4.5 to query live Gladius board for active/queued items. Discovery playbook already creates decision entries — the new gate enforces they're resolved before Planning. Commit: 58e21dd.
- **FEAT.25454 (search sort/date NL support) — SHIPPED & merged to `main`.** `sort_by`, `sort_dir`, `created_after`, `created_before` wired through translator → search endpoint. Code-fence stripping added to `extractText()` (Haiku wraps JSON in fences despite instructions). `type_name` gap in frontend `searchApi.query()` fixed as a bonus. "The oldest features" → sorted Feature list; "items from last week" → date-filtered list. Commit: 9a4a772.

## Next Up
1. **FEAT.25338 [P1]** — MCP → REST API refactor. All 5 decisions answered in Discovery, ready for Planning.
2. **Agent author_id fix [P2]** — executor and MCP `write_context_entry` write entries with `author_id=NULL`. Fix write path to use agent user (id 309). Unblocks non-admin Workers from edit/delete on agent entries.
2. **Raise max_tokens [P2]** — Dev/Test/Review/Deployment stages still 1024–1536. Planning fixed (8192). Raise rest to ≥8192 (default already updated in executor, but live DB playbook records need update).
3. **FEAT.25338 [P1]** — MCP → REST API refactor. All 5 decisions answered in Discovery, ready for Planning.

## Blockers
- (carry-over) npm `gladius` squat; parchment-vs-neutral theme decision still open.

## Last Updated
2026-06-23 — Session 36 (FEAT.25454 search sort/date; FEAT.25361 discovery readiness gate; session-start board read)
