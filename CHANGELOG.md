# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
