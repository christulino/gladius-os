# Install Acceptance — Stranger Test

Manual acceptance for the two-step Docker install (FEAT.26616). Run on a machine
with a container runtime but **no Gladius checkout and no prior Gladius data**.

Time the *install*, not the runtime setup. If the machine has no container
runtime yet, install one first (see the README's Prerequisites) and start the
timer after `docker compose version` prints a version — on Windows that setup is
20–30 minutes on its own and is not what this test measures.

## Steps

**macOS / Linux**

1. `curl -O https://raw.githubusercontent.com/christulino/gladius-os/main/docker-compose.yml`
2. `docker compose up`
3. Wait for `[entrypoint] Starting Gladius API on :3000` in the logs.
4. Capture the password from the output — `Admin password (SAVE THIS — shown once):`
   followed by the password on the next line. If you scrolled past it:
   `docker compose logs app | grep -A1 "Admin password"`
5. Open http://localhost:3000/admin/ and log in as `admin@example.com`.

**Windows (PowerShell)**

1. `Invoke-WebRequest -Uri https://raw.githubusercontent.com/christulino/gladius-os/main/docker-compose.yml -OutFile docker-compose.yml`
2. `docker compose up`
3. Wait for `[entrypoint] Starting Gladius API on :3000` in the logs.
4. Capture the password from the output. If you scrolled past it:
   `docker compose logs app | Select-String "Admin password" -Context 0,1`
5. Open http://localhost:3000/admin/ and log in as `admin@example.com`.

> `curl -O` and `grep` do NOT work in Windows PowerShell — `curl` is aliased to
> `Invoke-WebRequest` (which has no `-O`) in PowerShell 5.1, and `grep` does not
> exist at all. Use the Windows column verbatim; that is the point of running
> this test on Windows.

## Pass criteria

- [ ] Total wall-clock from step 1 to a logged-in board is **under 5 minutes**,
      measured from a working container runtime (see the timing note above).
- [ ] **Zero files edited** — no `.env`, no compose edits.
- [ ] The board renders with the seeded "Feature Development" workflow.
- [ ] Restarting (`docker compose restart app`) keeps you logged in and does not
      reset data — confirms secret + schema + seed idempotency.
- [ ] The password captured on first boot still works after that restart, and is
      NOT reprinted (regression guard for #90).
- [ ] AI features are absent-but-not-broken: the UI loads; adding an Anthropic key
      under Settings → AI Models enables playbooks.

### Windows-only

- [ ] Every command in the Windows column ran as written, with no substitution.
- [ ] The README's Prerequisites steps matched reality — virtualization check,
      `wsl --install`, runtime install.

## Notes

- The generated admin password is shown once, in the first-boot logs only.
- `docker compose down -v` is the documented full reset (wipes DB + secrets).
- The published image is multi-arch (`linux/amd64`, `linux/arm64`). To confirm
  you are running native rather than emulated:
  `docker exec <app-container> node -e "console.log(process.arch)"`
