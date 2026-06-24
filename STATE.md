# STATE — Gladius

> Work item status lives on the Gladius board (use `get_session_context`).
> This file tracks project-level context only: blockers, goals, open questions.

## Right Now
Session 38 closed. MCP improvement sprint shipped — 4 features, 13 tools total (was 9):
- FEAT.25602: `write_context_entry` Bearer attribution fixed (`author_id` from `req.userId`)
- FEAT.25603: `write_context_entry` now accepts optional `title` param
- FEAT.25804: `set_work_item_fields`, `get_exit_criteria`, `ack_exit_criterion` tools + `apiPatch`
- FEAT.25805: `get_stage_playbook` tool + `GET /work-items/:id/stage-playbook` endpoint
- FEAT.25806: `execution_owner` guard — migration 021, executor early-return, PlaybookEditor toggle

## Blockers
- npm `gladius` name squat (open)
- parchment-vs-neutral theme decision (open)
- **Claude Desktop restart required** to activate updated `.mcp.json` (GLADIUS_API_KEY env var replacing DATABASE_URL — done in Session 37 Phase 0 but Desktop hasn't been restarted yet)

## Last Updated
2026-06-24 — session-close (tier: Standard)
