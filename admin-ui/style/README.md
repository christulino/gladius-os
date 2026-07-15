# Gladius — UI Style System

> Target design system. All new UI work follows these rules.
> When existing code conflicts with this document, this document wins.
> Updated: 2026-04-05

---

## Principles

1. **The board is primary.** Every other page exists to configure or support the board. The board should feel like a living instrument panel — everything else is the settings behind it.

2. **One detail pattern: the drawer.** All detail views, edit forms, and configuration panels open as a right-side drawer that pushes content left. No centered modals. No inline panels. The drawer is the only overlay.

3. **Tufte density.** Use symbols, color, position, and size to encode information — not sprawl. A small card should convey type, age, health, and ownership without reading a word. But don't sacrifice legibility for density.

4. **Consistent rhythm.** Same font sizes, same spacing, same hover states everywhere. No page should look like it was built by a different team.

5. **Quiet chrome, loud signals.** The UI frame (sidebar, headers, borders) should be quiet and recede. Signals that need attention (WIP violations, blocked items, SLA warnings) should be loud and unmissable.

---

## Table of Contents

- [Theme & Colors](style/theme.md) — Color tokens, signal palette
- [Typography](style/typography.md) — Font sizes, weights, conventions
- [Layout](style/layout.md) — Shell structure, page types, spacing
- [Surfaces](style/surfaces.md) — Cards, panels, backgrounds
- [The Drawer](style/drawer.md) — Drawer anatomy, variants, behavior
- [Navigation](style/navigation.md) — Sidebar structure and patterns
- [Components](style/components.md) — Buttons, badges, forms, tables, hover/focus
- [Board Layout](style/board.md) — Cards, swimlanes, insights, filters, metrics
- [Page-Specific Patterns](style/pages.md) — Organizations, work item types, workflows
- [Animation](style/animation.md) — Transitions and loading states
- [Implementation Checklist](style/checklist.md) — Verification before shipping

---

## Quick Reference

**Font sizes:** `text-xs` (12px) or `text-sm` (14px) only. Never arbitrary sizes.

**Colors:** Use the theme tokens. Signal palette for badges and status indicators.

**Spacing:** Use Tailwind scale only. `gap-3` is the standard vertical rhythm.

**The drawer:** `w-[420px]` standard, `w-[520px]` for complex entities. Header, body (scrollable), footer.

**The board:** Four-corner card encoding. Service class swimlanes (Expedite → Fixed Date → Standard → Deferred). Inline WIP editing on column headers.

**Contrast:** `--foreground` on `--card` ≥ 12:1. `--muted-foreground` on `--card` ≥ 5:1 (WCAG AA).
