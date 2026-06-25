# STATE — Gladius

> Work item status lives on the Gladius board (use `get_session_context`).
> This file tracks project-level context only: blockers, goals, open questions.

## Right Now
Session 40 closed. DEBT.25726 (write_context_entry 400) driven through full Worker dogfood path — confirmed already fixed, added regression tests (PR #7 merged). New `gladius-session-close` skill created to replace session-close for this project.

## Next Up
- DEBT.25774 (P1, Todo) — `get_work_item` MCP tool returns 500; pull to Discovery next session
- Three new dogfood observations in Backlog: DEBT.25773 (model:default silent failure), FEAT.25775 (get_available_transitions tool)

## Blockers
- npm `gladius` name squat (open)
- parchment-vs-neutral theme decision (open)
- Claude Desktop restart still required to activate updated `.mcp.json` (GLADIUS_API_KEY env var) — does not affect Claude Code CLI sessions

## Last Updated
2026-06-25 — session-close (tier: Gladius)
