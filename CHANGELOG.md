# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-07-25

Onramp release — install and try Gladius in two commands, with a guided path to
the moment work gets gated.

### Added

- **Two-step Docker install** — `curl` the compose file and `docker compose up`
  to reach a logged-in, seeded board on a fresh machine in minutes with zero env
  editing. Published container image at `ghcr.io/christulino/gladius-os`; the app
  entrypoint auto-generates and persists secrets, applies the base schema, runs
  migrations, and seeds on first boot. (#87)
- **Quickstart guide** (`docs/quickstart.md`) — a ~10-minute walkthrough to the
  moment a stage gate refuses to advance an item until its exit criteria are met.
  (#89)
- **Decision-resolution MCP tools** — `resolve_decision` and `reopen_decision`
  bring the MCP surface to 19 tools; decision resolve/reopen events now render in
  the audit trail. (#85)

### Changed

- **README** rewritten around the product's actual positioning — the
  gate-and-memory layer for AI-assisted work — with Kanban flow as the
  foundation. (#91)
- **Compose split** — the root `docker-compose.yml` is now the full
  published-image install stack; the Postgres-only development stack moved to
  `docker-compose.dev.yml`. (#87)
- Assembled context now renders a decision's resolved/reopened state so playbooks
  stop re-litigating settled questions. (#86)

### Fixed

- **Self-host login over HTTP** — the session cookie was `secure` in production
  and was silently dropped over plain `http://localhost`, so login returned 200
  but no session persisted and the app was unusable past the login screen. The
  cookie is now `secure: 'auto'` — it works over http and stays `Secure` over
  https. (#88)
- **Admin password stability** — the solo seed regenerated and overwrote the
  admin password on every boot, so a container restart invalidated the password
  saved from first boot. A generated password is now written only on the initial
  insert; an explicitly-set `GLADIUS_SOLO_PASSWORD` stays authoritative. (#90)

## [0.1.0] - 2026-07-15

Initial public release of Gladius — a self-hosted, open source work operating
system built on Kanban and Lean flow principles.

### Added

- **Flow engine** — configurable workflows, stages, and a two-phase
  (prepare → execute) transition engine, gated by exit criteria (manual and
  codified conditions, with a waiver/audit trail).
- **Work items** — CRUD, custom fields, parent/child and related-item
  linking, comment threads with edit/delete, and a Kanban board with
  multi-select bulk transition/assignment.
- **Search** — natural-language → structured-filter translation (via the
  Anthropic API) alongside full-text search and saved filters.
- **Notifications** — event-driven, in-app and agent delivery channels with
  retry/backoff.
- **Audit trail** — append-only event log per work item, with a per-field
  change history view.
- **Attachments** — link attachments on work items.
- **AI context layer** — per-item context journal, an org-level context
  library, stage playbooks (YAML-frontmatter markdown instructions that
  execute on stage entry), and a bundled MCP stdio server so external AI
  agents can read context, write journal entries, transition items, and
  comment.
- **Auth** — session-based authentication plus hashed API tokens for
  programmatic/MCP access.
- **CI** — GitHub Actions workflow running lint and the integration test
  suite on pull requests.
- **Install** — a `docker compose` + `npm run seed` path that provisions
  Postgres, applies migrations, and seeds a ready-to-use single-org
  workspace.
