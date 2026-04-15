# Implementation Checklist

## 18. Implementation Checklist

When building or modifying any component, verify:

**Layout & navigation:**
- [ ] No top bar — logo is in sidebar
- [ ] Sidebar follows the defined section grouping (Board, Catalog, Configure, Admin, Reports, Dev Tools)
- [ ] Detail/edit views open in the drawer (pushes content left), not a modal or inline panel
- [ ] Drawer uses correct width: 420px standard, 520px for WIT config and work item detail
- [ ] Navigating away closes the drawer

**Typography & contrast:**
- [ ] Font sizes are only `text-xs` or `text-sm` (no arbitrary sizes)
- [ ] No `font-mono` anywhere
- [ ] Labels use `text-xs font-medium uppercase tracking-wide text-muted-foreground`
- [ ] Contrast ratios meet WCAG AA (especially muted-foreground on card)

**Components:**
- [ ] Inputs use `text-xs px-2 py-1.5 bg-background border border-border rounded`
- [ ] Hover states use `hover:bg-black/[0.03]` (surfaces) or `hover:border-primary/40` (cards)
- [ ] Spacing follows the spacing table (no mixed padding values)
- [ ] Buttons use `text-xs font-medium rounded` (no `font-mono`)
- [ ] Badge uses the Badge component (no inline color styles)
- [ ] Loading/empty/error states use the standard pattern

**Board:**
- [ ] Board cards use four-corner encoding (icon, assignee, total-time, stage-time)
- [ ] No display key or "touched" time on cards (those live in the drawer)
- [ ] Org cards use `rounded-sm`, personal cards use `rounded-lg`
- [ ] Blocked cards: red border, ✕ icon in TR, blocked timer in red on bottom row
- [ ] Blocked items do NOT consume WIP capacity
- [ ] Queue sub-columns appear only when items are queued (dashed separator)
- [ ] Queued items are slightly muted (`opacity-80`), not counted in WIP
- [ ] No Cancelled column — cancelled items leave the board
- [ ] Done items auto-hide after 7 days (configurable per org)
- [ ] WIP limits are inline-editable on column headers, not in a drawer or workflow editor
- [ ] Column headers show stage metrics (avg time or throughput, async-loaded)
- [ ] Done column shows lead time + throughput instead of time-in-stage
- [ ] Stage metrics respond to active filters (org, type)
- [ ] Service class swimlanes ordered: Expedite → Fixed Date → Standard → Deferred
- [ ] Empty swimlanes are hidden, not shown as blank rows
- [ ] Metric popover allows rolling period + metric type selection
- [ ] Workflow editor has NO WIP limit fields — WIP is org-level on the board
- [ ] Workflow editor stage properties include `has_queue` toggle
- [ ] Stages have a `final` flag — the last stage(s) in a workflow (Done equivalent)
