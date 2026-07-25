# Install Acceptance — Stranger Test

Manual acceptance for the two-step Docker install (FEAT.26616). Run on a machine
with Docker but **no Gladius checkout and no prior Gladius data**. Start a timer.

## Steps

1. `curl -O https://raw.githubusercontent.com/christulino/gladius-os/main/docker-compose.yml`
2. `docker compose up`
3. Wait for `[entrypoint] Starting Gladius API on :3000` in the logs.
4. `docker compose logs app | grep -A1 "Admin password"` — capture the password.
5. Open http://localhost:3000/admin/ and log in as `admin@example.com`.

## Pass criteria

- [ ] Total wall-clock from step 1 to a logged-in board is **under 5 minutes**.
- [ ] **Zero files edited** — no `.env`, no compose edits.
- [ ] The board renders with the seeded "Feature Development" workflow.
- [ ] Restarting (`docker compose restart app`) keeps you logged in and does not
      reset data — confirms secret + schema + seed idempotency.
- [ ] AI features are absent-but-not-broken: the UI loads; adding an Anthropic key
      under Settings → AI Models enables playbooks.

## Notes

- The generated admin password is shown once, in the first-boot logs only.
- `docker compose down -v` is the documented full reset (wipes DB + secrets).
