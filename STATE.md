# STATE — FlowOS

## Right Now
- Attachments v1 fully shipped end-to-end. Migration applied, 24 commits merged + pushed to `origin/main` (HEAD = `b99d3e8`).
- Tier 1 parity feature #4 closed. PRODUCT_PLAN updated. Browser-smoke-tested.

## Next Up
1. Pick the next feature. Top contenders per `PRODUCT_PLAN.md`:
   - **Stage-evidence requirements** — natural follow-up to attachments; named per-stage slots that gate transitions (the second half of the original "evidence" mental model).
   - **Bulk operations** — Tier 1 #6, smaller and self-contained; multi-select transition/assign.
   - **SLA tracking** — Tier 2 #9, highest-leverage Phase 3 item; sits on the live event system.
2. **[P1] Comment edit/delete endpoints + event emissions** — searchIndex subscriber declares handlers but API doesn't expose PATCH/DELETE.
3. **[P1] Test isolation flake** — full `npm test` now hangs `node --test` workers (worse than recorded). Was P2; consider promoting.

## Blockers
- None.

## Last Updated
2026-05-08 — by session-close (tier: Full)
