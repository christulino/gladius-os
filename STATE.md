# STATE — Gladius

> Work item status lives on the Gladius board (use `get_session_context`).
> This file tracks project-level context only: blockers, goals, open questions.

## Right Now
Session 39 closed. DEBT.25478 (NL search dead) resolved via full dogfood workflow:
- Root cause was already fixed by FEAT.25454; this session added visible error surface + 5 HTTP contract tests
- Dogfood observations: in-server Discovery/Planning playbooks ran cleanly; `no_unresolved_decisions` gate caught the playbook-authored decision and blocked Planning transition correctly

## Next Up
- DEBT.25477 (rank-04, P1) — Journal renders AI output as raw escaped JSON; markdown not parsed. Currently in Discovery on dogfood board.
- Board cleanup: ~10 "Field writes test" P2 artifact items from Session 38 testing + FEAT.25602–25606 need to be transitioned to Done

## Blockers
- npm `gladius` name squat (open)
- parchment-vs-neutral theme decision (open)
- **Claude Desktop restart required** to activate updated `.mcp.json` (GLADIUS_API_KEY env var replacing DATABASE_URL — done in Session 37 Phase 0 but Desktop hasn't been restarted yet)

## Last Updated
2026-06-24 — session-close (tier: Standard)
