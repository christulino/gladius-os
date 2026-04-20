# FlowOS — Parking Lot

## Open

### [2026-04-16] Event system v1 limitations to revisit under load
**Status:** Open
**Context:** Known deferred items from session 20:
- Sequential subscriber drain — one slow handler blocks others. Fine at 20 events/hour, revisit at scale.
- No per-tick event budget — a subscriber with a huge backlog monopolizes its drain. Same scale threshold.
- No retention cron — events accumulate forever. Add when volume warrants (probably around first real deployment).
- Cross-instance nudging uses 30s safety poll, not LISTEN/NOTIFY. Fine for HA mode; add NOTIFY if multi-instance latency becomes visible.
- Three v1 event types deferred because endpoints don't exist: `work_item.unlinked` (need DELETE /links), `work_item.comment_edited`, `work_item.comment_deleted`. Emit when those endpoints are built.

## Resolved

### [2026-04-18] Split events test file — drainNow tests conflict with live server
**Status:** Resolved
**Context:** Split `tests/events-system.test.js` into `tests/events-processor.test.js` (emitEvent + `cursor and drain` + neo4jSync/auditLog handler tests — run with no live server) and `tests/events-integration.test.js` (all describes that hit `api(...)` + advisory-lock check — requires `npm run dev`). Processor file runs cleanly: 16/16 assertions pass. Neo4j driver keeps the test process alive ~until idle-timeout; cosmetic only.

### [2026-04-16] GitHub push credentials expired
**Status:** Resolved
**Context:** `git push origin main` was failing with HTTP 400 / "send-pack unexpected disconnect". Initially suspected as an expired PAT, but `git ls-remote` succeeded — auth was fine. Real cause: the default `http.postBuffer` (1 MB) was too small for the packed body of 12 commits / 431 objects. Raising `http.postBuffer` to 512 MB (`git config http.postBuffer 524288000`) unblocked the push. All local commits (through `26b295d`) are now on origin.
