# FlowOS — Parking Lot

## Open

### [2026-04-20] Orphan `runtime.notification_preferences` table
**Status:** Open
**Context:** A `runtime.notification_preferences` table exists from an earlier experimental session — schema is `(id, user_id, notification_type, channel, is_enabled, …)`, 0 rows, not referenced by any v1 code. Candidate for a cleanup migration. Low priority; doesn't hurt anything but adds noise when inspecting the schema.

### [2026-04-20] Missing ESLint config
**Status:** Open
**Context:** CLAUDE.md instructs "run `npx eslint .` before declaring any task complete," but the project has no `.eslintrc.json` / `eslint.config.js` / eslint config in `package.json`. Every subagent this session flagged this as a pre-existing condition. Fix by either (a) adding a minimal config, or (b) removing the rule from CLAUDE.md. Recommend (a) with a FlowOS-appropriate ruleset.

### [2026-04-20] Manual smoke of notifications channels
**Status:** Open
**Context:** Unit + integration tests all green, but real-world verification hasn't been done. Need to: (1) configure a real webhook URL with a valid ownership-challenge handler and confirm POSTs arrive signed, (2) configure SMTP and send a real email for a realtime + a digest, (3) point the agent channel at an actual LLM endpoint and verify the prompt envelope arrives intact. Risk: each of these is a plausible source of hidden bugs that integration tests couldn't cover.

### [2026-04-20] Notification event types awaiting emission sites
**Status:** Open
**Context:** Three v1 event types in the notifications matrix have no emission sites yet because their underlying endpoints don't exist: `work_item.unlinked` (needs DELETE /links), `work_item.comment_edited`, `work_item.comment_deleted`. When those endpoints are built, wire up `emitEvent` calls and add their types to the `HANDLED` Set in `runtime/subscribers/notifications.js`.

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
