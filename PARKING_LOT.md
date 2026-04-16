# FlowOS — Parking Lot

## Open

_No open items._

## Resolved

### [2026-04-16] GitHub push credentials expired
**Status:** Resolved
**Context:** `git push origin main` was failing with HTTP 400 / "send-pack unexpected disconnect". Initially suspected as an expired PAT, but `git ls-remote` succeeded — auth was fine. Real cause: the default `http.postBuffer` (1 MB) was too small for the packed body of 12 commits / 431 objects. Raising `http.postBuffer` to 512 MB (`git config http.postBuffer 524288000`) unblocked the push. All local commits (through `26b295d`) are now on origin.
