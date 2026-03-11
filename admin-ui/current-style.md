# Flow OS — UI Style System

> Target design system. All new UI work follows these rules.
> When existing code conflicts with this document, this document wins.
> Updated: 2026-03-11

---

## Principles

1. **The board is primary.** Every other page exists to configure or support the board. The board should feel like a living instrument panel — everything else is the settings behind it.

2. **One detail pattern: the drawer.** All detail views, edit forms, and configuration panels open as a right-side drawer that pushes content left. No centered modals. No inline panels. The drawer is the only overlay.

3. **Tufte density.** Use symbols, color, position, and size to encode information — not sprawl. A small card should convey type, age, health, and ownership without reading a word. But don't sacrifice legibility for density.

4. **Consistent rhythm.** Same font sizes, same spacing, same hover states everywhere. No page should look like it was built by a different team.

5. **Quiet chrome, loud signals.** The UI frame (sidebar, headers, borders) should be quiet and recede. Signals that need attention (WIP violations, blocked items, SLA warnings) should be loud and unmissable.

---

## 1. Theme

**Cartography light theme** — warm parchment surfaces, forest green primary, muted map-inspired accents. No dark mode. Higher contrast than typical "soft" themes — text must be easy to read.

### Color tokens

| Token | HSL | Hex | Use |
|-------|-----|-----|-----|
| `--background` | 38 18% 88% | #E8E1D5 | Page background (parchment) |
| `--foreground` | 28 25% 10% | #1A1310 | Primary text (darkened for contrast) |
| `--card` | 36 26% 96% | #F6F2EB | Cards, panels, sidebar, drawer |
| `--primary` | 152 38% 28% | #2B6645 | Primary actions, active nav, save buttons |
| `--secondary` | 36 16% 82% | #D8D0C2 | Secondary buttons, subtle fills |
| `--muted` | 36 14% 83% | #D9D1C4 | Table headers, disabled fills |
| `--muted-foreground` | 28 16% 38% | #665849 | Secondary text, labels (darkened for contrast) |
| `--accent` | 208 40% 36% | #356D91 | Links, info badges (map blue) |
| `--destructive` | 10 50% 38% | #993522 | Errors, warnings, over-limit (terracotta) |
| `--border` | 35 20% 70% | #BDB3A0 | All borders (darkened for visibility) |

**Contrast targets:** `--foreground` on `--card` ≥ 12:1. `--muted-foreground` on `--card` ≥ 5:1 (WCAG AA). `--border` on `--card` visible without squinting.

### Signal palette (badges, service classes, status indicators)

| Name | Hex | Use |
|------|-----|-----|
| `--map-green` | #2D6A3C | Active, published, healthy |
| `--map-blue` | #356D91 | Info, accent, linked |
| `--map-amber` | #AD7B1A | Warning, customized, aging |
| `--map-red` | #A33A25 | Error, blocked, over-limit |
| `--map-brown` | #7A5535 | System, template, inherited |

---

## 2. Typography

**Font:** Inter only. `font-sans` everywhere. Remove `font-mono` from all UI — it resolves to Inter anyway and creates false visual distinction.

### Size scale (3 sizes only)

| Token | Size | Use |
|-------|------|-----|
| `text-xs` | 12px | Body text, table cells, inputs, card content, form fields, badges |
| `text-sm` | 14px | Section headers, panel titles, drawer titles, stage names, page titles |
| `text-base` | 16px | Reserved — only if we need a hero-level heading in the future |

**No arbitrary sizes.** No `text-[9px]`, `text-[10px]`, `text-[11px]`. Everything is `text-xs` or `text-sm`.

### Weight & style conventions

| Role | Classes |
|------|---------|
| Body text | `text-xs text-foreground` |
| Secondary/meta text | `text-xs text-muted-foreground` |
| Field label | `text-xs font-medium text-muted-foreground uppercase tracking-wide` |
| Hint text | `text-xs text-muted-foreground/60` |
| Section header | `text-sm font-semibold text-foreground` |
| Panel/drawer title | `text-sm font-semibold` |
| Data value (key, timestamp, count) | `text-xs text-muted-foreground tabular-nums` |

### Rules
- **Labels** use `uppercase tracking-wide font-medium` at `text-xs` — this creates visual distinction without needing a different font
- **Titles** use `font-semibold` at `text-sm`
- **Never** use `font-mono` — it doesn't do anything and it's misleading
- **Never** use arbitrary font sizes — only `text-xs` and `text-sm`

---

## 3. Layout

### Shell

No top bar. The logo/app name lives at the top of the sidebar. All vertical space goes to content.

```
h-screen flex overflow-hidden
├── Sidebar: w-44 bg-card border-r border-border flex flex-col
│   ├── Logo/app name area (top of sidebar)
│   └── Nav items
└── Main area: flex-1 flex
    ├── Main content: flex-1 (layout depends on page type)
    └── Drawer: w-[420px] bg-card border-l border-border (when open, pushes main)
```

### Page types

**Table page** (Organizations, WitTypes, Users, Roles):
```
Main: flex-1 overflow-auto p-5
└── Panel (rounded, bordered)
    ├── PanelHeader (title + actions)
    └── DataTable (sticky header, scrollable body)
```

**Canvas page** (Board, Workflow Editor):
```
Main: flex-1 overflow-hidden flex flex-col
├── Toolbar zone (see Board Layout for full structure)
└── Canvas: flex-1 overflow-auto (page manages its own scroll)
```

### Drawer integration
- The drawer is a **sibling of main content**, not an overlay
- When open: main content area shrinks, drawer takes `w-[420px]` on the right
- Transition: `transition-all duration-200`
- Navigating to a different sidebar page closes any open drawer
- The drawer has its own vertical scroll, independent of main content

---

## 4. Surfaces

| Surface | Classes | Where |
|---------|---------|-------|
| Page background | `bg-background` | Behind everything |
| Panel | `bg-card border border-border rounded-md` | Table pages, config sections |
| Card (org) | `bg-card border border-border rounded-sm` | Board cards belonging to an org (sharp corners) |
| Card (personal) | `bg-card border border-border rounded-lg` | Board cards with no org (personal items — rounded corners) |
| Drawer | `bg-card border-l border-border` | Right-side detail/edit |
| Toolbar | `bg-card border-b border-border` | Board toolbar, panel headers |
| Dropdown | `bg-card border border-border rounded shadow-md` | Menus, pickers |
| Inset section | `bg-background rounded border border-border` | Nested sections inside drawer |

**Rules:**
- Cards and panels always use `bg-card`
- Inset/nested content inside a `bg-card` surface uses `bg-background` to create depth
- Only one level of nesting — never `bg-card` inside `bg-card` without visual separation
- `shadow-md` only on floating elements (dropdowns). No shadows on panels, cards, or drawers.

---

## 5. The Drawer

The drawer is the **single overlay/detail pattern** in the application. It replaces:
- The current FormDrawer (Sheet) — create/edit forms on table pages
- The current WorkItemDetail (Dialog) — work item detail from the board
- The current Stage Editor (inline panel) — workflow stage editing

### Anatomy

```
┌─────────────────────────────────────────┐
│ Drawer Header                    [X]    │  border-b, px-4 py-3
│  Title (text-sm font-semibold)          │
│  Subtitle/meta (text-xs muted)          │
├─────────────────────────────────────────┤
│                                         │
│ Drawer Body                             │  flex-1 overflow-y-auto, p-4
│  Content (forms, details, tabs)         │
│                                         │
├─────────────────────────────────────────┤
│ Drawer Footer                           │  border-t, px-4 py-3
│  [Cancel]                 [Save]        │  justify-between or justify-end
└─────────────────────────────────────────┘
```

### Behavior
- Opens from the right, pushes main content left
- Close via X button or Escape key
- Stays open on outside click (clicking main content does NOT close it)
- Footer always visible (not scrolled)
- Header always visible (not scrolled)
- Only the body scrolls

### Drawer widths

| Context | Width | Why |
|---------|-------|-----|
| Standard form | `w-[420px]` | Org edit, user edit, role edit, class edit, service class edit, stage edit |
| Work item type config | `w-[520px]` | Needs room for fields, workflow preview, exit criteria, custom field definitions |
| Work item detail | `w-[520px]` | Needs room for tabs, actions, comments, field values, linked items |
| Second (stacked) drawer | `w-[480px]` | Workflow viewer, linked entity detail |

### Drawer variants

**Form drawer** (create/edit entities):
- Body contains vertical field list with `gap-4`
- Footer: `[Cancel] [Save]`
- Used for: org edit, class edit, user edit, role edit, stage edit

**Config drawer** (complex entity configuration):
- Wider (`w-[520px]`) for entities with many sections
- Body may have tabs or collapsible sections
- Footer: `[Cancel] [Save]`
- Used for: work item type config (fields, workflow, exit criteria, rules)

**Detail drawer** (view + act on an entity):
- Wider (`w-[520px]`) for content-rich views
- Header shows entity identity (icon, title, key)
- Body may have tabs (e.g., Details / Comments / History)
- Footer: context-dependent actions or omitted
- Used for: work item detail, org detail

**All variants use the same Drawer component.** The difference is in content and width, not structure.

### Drawer stacking (limited)
- A second drawer may open on top of the first (e.g., viewing a workflow diagram from within a work item type edit)
- Maximum depth: 2. The second drawer slides in from the right over the first.
- The first drawer dims slightly to show it's behind.
- Closing the second drawer reveals the first, intact.
- This is the exception, not the rule — most interactions use a single drawer.

### Tabs inside drawer
- When a drawer has multiple sections, use **underline tabs** below the header
- Tab bar: `border-b border-border`, tabs are `text-xs px-3 py-2`
- Active tab: `text-primary border-b-2 border-primary`
- Inactive tab: `text-muted-foreground hover:text-foreground`

---

## 6. Navigation

### Sidebar structure

The sidebar is the only navigation. No top bar. Logo/app identity at the top.

```
┌──────────────────────┐
│  ◈ Flow OS           │  Logo + app name, compact
│                      │
│  Board               │  ← primary, always first
│                      │
│  CATALOG             │  section header
│    Organizations     │  tree view (main content)
│    Work Item Types   │  search-oriented
│                      │
│  CONFIGURE           │  section header
│    Workflows         │  visual editor
│    Service Classes   │
│                      │
│  ADMIN               │  section header (admin-only)
│    Users             │
│    Roles             │
│                      │
│  REPORTS             │  section header
│    (blank for now)   │
│                      │
│  ─────────────────── │  separator (dev only, hidden in prod)
│  DEV TOOLS           │
│    Raw Tables        │
│    DB Console        │
│    Log Viewer        │
└──────────────────────┘
```

### Sidebar styling
- App name: `text-sm font-semibold text-foreground px-3 py-3`
- Section headers: `text-xs font-medium text-muted-foreground uppercase tracking-wide px-3 pt-4 pb-1`
- Nav items: `text-xs px-3 py-1.5 rounded-sm cursor-pointer`
- Active: `text-primary bg-primary/10 font-medium`
- Inactive: `text-muted-foreground`
- Hover: `hover:bg-black/[0.04]`
- Dot indicator for active: `w-1.5 h-1.5 rounded-full bg-primary`
- Section headers are visible, not just implied by spacing

### Navigation behavior
- Clicking a sidebar item navigates to that page and closes any open drawer
- Clicking an entity within a page (table row, tree node, search result) opens its detail in the drawer
- Cross-entity links inside a drawer (e.g., a type's workflow) may open a second drawer (max depth 2)

### Page-specific navigation patterns

**Organizations page:** Main content shows an org tree. Clicking an org opens a drawer with org info + that org's service catalog (its work item types). Expandable/collapsible tree nodes.

**Work Item Types page:** For non-admin users, this is a search screen — type a term like "jira" or "sizing" and see matching orgs and work item types. For admins, also shows the full table with create/edit in drawer.

**Workflows page:** Visual workflow editor in main content. Clicking a stage opens the stage editor in the drawer. Work item type edit drawers should show a mini workflow diagram or a link to open the workflow in a second drawer.

---

## 7. Buttons

### Variants

| Variant | Look | When to use |
|---------|------|-------------|
| `default` | `bg-primary text-white` | Primary action per context (Save, Create, Submit) |
| `outline` | `border border-border text-muted-foreground` | Secondary actions (Cancel, Filter, Close) |
| `ghost` | No border, no bg | Subtle/inline actions (icon buttons, toolbar toggles) |
| `destructive` | `border border-destructive/30 text-destructive` | Destructive actions (Remove, Delete) |

### Sizes

| Size | Classes | When |
|------|---------|------|
| `default` | `h-8 px-3 text-xs` | Form buttons, toolbar actions |
| `sm` | `h-7 px-2.5 text-xs` | Compact contexts (table rows, card actions, inline) |
| `icon` | `h-8 w-8` | Icon-only buttons |

### Rules
- All buttons: `rounded font-medium text-xs`
- No `font-mono` on buttons
- One primary button per context (footer, toolbar section, form)
- `+ Add X` buttons: `default` variant, `sm` size
- Cancel is always `outline`
- Only use `destructive` for irreversible actions

---

## 8. Badges

All badges: `text-xs rounded-full px-2 py-0.5 font-medium`

| Variant | Colors | Use |
|---------|--------|-----|
| `default` | Green bg/text/border (map-green) | Active, published, healthy |
| `blue` | Blue bg/text/border (map-blue) | Info, linked, accent |
| `amber` | Amber bg/text/border (map-amber) | Warning, customized, aging |
| `red` | Red bg/text/border (map-red) | Error, blocked, critical |
| `brown` | Brown bg/text/border (map-brown) | System, template, global |
| `muted` | Muted bg, muted-foreground text | Inactive, draft, neutral |
| `outline` | Border only, muted text | Lightweight/de-emphasized |

**Badge backgrounds** use `/10` opacity of the color. **Badge borders** use `/25` opacity.

### Rules
- Badges are for **status** and **classification**, not for decoration
- One badge variant per semantic meaning — don't use `amber` for both "warning" and "customized" on the same screen
- Service class badges on cards: use the Badge component with dynamic color, not inline styles

---

## 9. Forms & Inputs

### Text input
```
w-full bg-background border border-border rounded text-xs text-foreground
px-2 py-1.5 focus:outline-none focus:border-primary
placeholder:text-muted-foreground/40
```

### Select
Same base as text input. Default option text: `-- select --`

### Textarea
Same base + `resize-y rows={3}`

### Boolean
`<Switch>` + label: `text-xs text-muted-foreground` showing "Yes" / "No"

### Checkbox
Native `<input type="checkbox" className="accent-primary" />`

### Color picker
Swatch + hex input. Shared `<ColorPicker>` component.

### Image upload
Avatar preview + upload button. Shared `<ImageField>` component.

### Field layout
```jsx
<div className="flex flex-col gap-1">
  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
    {label} {required && <span className="text-destructive/70">*</span>}
  </label>
  {hint && <p className="text-xs text-muted-foreground/60">{hint}</p>}
  {input}
</div>
```

### Rules
- **All inputs are `text-xs`** — no `text-sm` inputs anywhere
- **All inputs use the same padding:** `px-2 py-1.5`
- **No `font-mono` on inputs** — just `text-xs text-foreground`
- Fields in a form: `gap-3` vertical spacing
- Sections within a form: separated by `border-t border-border pt-3 mt-1`

---

## 10. Tables (DataTable)

| Part | Classes |
|------|---------|
| Container | `bg-card border border-border rounded-md overflow-hidden` |
| Header row | `sticky top-0 z-10 bg-card border-b border-border` |
| Header cell | `px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide text-left` |
| Body cell | `px-3 py-1.5 text-xs text-foreground` |
| Row hover | `hover:bg-black/[0.03]` |
| Row border | `border-b border-border/40` |
| Clickable row | `cursor-pointer` |
| Pagination | `px-3 py-2 border-t border-border text-xs text-muted-foreground` |

### Rules
- Cell max-width: `max-w-[280px] truncate` for text columns
- Row height should be consistent — `py-2` on all cells
- Clickable rows open the drawer (not a new page)
- No zebra striping — hover state is sufficient
- Header text matches label convention: `text-xs font-medium uppercase tracking-wide`

---

## 11. Hover & Focus States

**One hover pattern everywhere:**
- Interactive surfaces (rows, nav items, dropdown items, list items): `hover:bg-black/[0.03]`
- Cards: `hover:border-primary/40` (border highlight, not background change)
- Buttons: handled by button component (darken/lighten)

**Focus:**
- Inputs: `focus:outline-none focus:border-primary`
- Buttons: `focus-visible:ring-2 focus-visible:ring-primary/30`
- Interactive elements: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30`

**Active/pressed:**
- Buttons: `active:scale-[0.98]` (subtle press feedback)

---

## 12. Spacing

### Standard values

| Context | Value |
|---------|-------|
| Page padding | `p-4` |
| Panel/drawer header & footer | `px-4 py-2.5` |
| Drawer body | `p-4` |
| Form field gap | `gap-3` |
| Label to input | `gap-1` |
| Form section divider | `border-t border-border pt-3 mt-1` |
| Card internal padding | `p-2` |
| Card internal gap | `gap-0.5` |
| Table cell padding | `px-3 py-1.5` |
| Badge padding | `px-2 py-0.5` |
| Input padding | `px-2 py-1.5` |
| Toolbar padding | `px-4 py-2` |
| Button gap (row of buttons) | `gap-2` |

### Rules
- Use Tailwind spacing scale only — no arbitrary values for spacing
- `gap-3` is the standard vertical rhythm for form content (tight enough to reduce scrolling)
- `gap-2` is the standard horizontal gap for inline elements (buttons, badges, meta)
- `p-2` for compact cards, `p-4` for drawers and page-level
- **Minimize vertical space** — prefer tighter padding over generous whitespace. Scrolling is the enemy of scanning.

---

## 13. Opacity Conventions

| Purpose | Opacity |
|---------|---------|
| Badge backgrounds | `/10` |
| Badge borders | `/25` |
| Subtle borders (row separators) | `/40` |
| Hover backgrounds | `/[0.03]` (use `bg-black/[0.03]`) |
| Hint text / very muted | `/60` |
| Placeholder text | `/40` |
| Disabled elements | `opacity-50` |

---

## 14. Loading & Empty States

- **Loading:** `text-xs text-muted-foreground` centered in container, text "Loading..."
- **Error:** `text-xs text-destructive` centered in container
- **Empty table/list:** `text-xs text-muted-foreground` centered, contextual message ("No work items found")
- **Empty board column:** dashed border placeholder `border border-dashed border-border/50 rounded p-4 text-center`

No spinners. No skeletons. Just text. (Revisit if loading times become noticeable.)

---

## 15. Board Layout

The board is the primary view — a canvas page with structured vertical zones. It is a flow health instrument, not a task list.

### Vertical structure

```
┌──────────────────────────────────────────────────────────────────────────┐
│ INSIGHTS BAR (collapsed when empty)                                      │
│  ⚠ 3 items blocked >48h in Triage  ◷ Avg cycle time up 20%              │
│  ▲ WIP exceeded in Development (4/3)                                     │
├──────────────────────────────────────────────────────────────────────────┤
│ FILTER BAR                                                               │
│  [Org ▾] [Type ▾] [■ Blocked] [◷ Delayed] [... more]                    │
├──────┬──────┬──┊──────┬──┊──────┬──┊──────┬──────────────────────────────┤
│ COLUMN HEADERS with metrics          (┊ = queue split, shown when needed)│
│Inbox │Triage│Q ┊ Dev  │Q ┊Review│Q ┊ Done │                             │
│ 3    │ 3/5  │  ┊ 4/3! │  ┊ 1/2  │  ┊  12  │                            │
│~1d2h │~4h   │  ┊~3d1h │  ┊~6h   │  ┊ ~8d LT · 15 done                 │
├──────┼──────┼──┊──────┼──┊──────┼──┊──────┼──────────────────────────────┤
│ E    │cards │cards    │  │cards │  │      │ cards                        │
│ x    ├──────┼──┊──────┤  ├──────┤  │      ├──────                        │
│ p    │      │  ┊      │  │      │  │      │                              │
├──────┼──────┼──┊──────┼──┊──────┼──┊──────┼──────                        │
│ S    │cards │  ┊cards │cc┊cards │  ┊cards │ cards                        │
│ t    │      │  ┊      │  ┊      │  ┊      │                              │
│ d    │cards │  ┊cards │  ┊cards │  ┊cards │ cards                        │
└──────┴──────┴──┴──────┴──┴──────┴──┴──────┴──────────────────────────────┘
  ↑ swimlane labels (rotated, left edge)
  ↑ queue sub-columns appear only when items are queued (dashed separator)
```

**Key board concepts:**
- **No Cancelled column.** Cancelled items leave the board entirely.
- **Done items auto-hide after 7 days** (default). Configurable per org.
- **Queue sub-columns** appear dynamically when a stage has `has_queue: true` and items are waiting.

### Insights bar
- **Collapsed by default** — only visible when there are insights to show
- Generated by an AI-driven analysis program that identifies blockages, delays, anomalies
- May not run on every page load — insights are cached/periodic
- Background: `bg-card border-b border-border`
- Each insight is one line with a leading icon (⚠ warning, ◷ timing, ▲ limit, etc.)
- Text: `text-xs text-foreground`, icons provide categorization
- Padding: `px-4 py-2`
- Dismissable with an X, or auto-collapses when insights are cleared
- Typically 1–3 lines. Icons encode category so text can be concise.

### Filter bar
- Background: `bg-card border-b border-border px-4 py-2`
- Structured set of filter buttons/dropdowns:
  - **Org filter** — dropdown multiselect
  - **Type filter** — dropdown multiselect
  - **Blocked** — toggle button, highlights when active
  - **Delayed** — toggle button, highlights when active
- All filters: `text-xs`, compact, `outline` button style when inactive, `default` when active
- Filters affect which cards are visible AND which data feeds the stage metrics
- When multiple orgs or types are filtered, metrics aggregate across the filtered set

### Column headers

Each column header has three layers:

```
┌─────────────────┐
│ Stage Name      │  text-sm font-semibold
│ 4/3!            │  WIP count/limit (inline-editable)
│ ~3d 1h          │  stage metric (async-loaded, clickable)
└─────────────────┘
```

**Stage name:** `text-sm font-semibold text-foreground`

**WIP display:** `text-xs text-muted-foreground tabular-nums` — shows `count/limit`
  - No limit set: just show count
  - At/over limit: text becomes `text-destructive font-semibold`
  - Over-limit column: header background `bg-destructive/10`, border `border-destructive/30`
  - **WIP is inline-editable** — clicking the limit value turns it into a small input field
    - Only for users with permission
    - Saves on blur or Enter, no drawer needed
    - Input: `w-10 text-xs text-center border border-border rounded px-1 py-0.5`

**Stage metrics:** `text-xs text-muted-foreground tabular-nums`
  - **Default metric:** Average time in stage (rolling 30-day window)
  - Format: `~3d 1h` (tilde prefix indicates "average")
  - **Async-loaded** — appears after cards are loaded, does not block board render
  - **Clickable** — clicking opens a small popover (not a drawer) with options:
    - Rolling time period: 7d / 14d / 30d / 60d / 90d
    - Metric type toggle: "Avg time in stage" vs "Throughput"
    - Throughput format: `15 items` (count through this stage in the rolling period)
  - Metric selection persists in localStorage per user
  - Popover: `bg-card border border-border rounded shadow-md p-3 text-xs`

**Done column special metrics:**
  - Instead of "avg time in stage," Done shows:
    - **Average lead time** (intake → done): `~8d LT`
    - **Throughput:** `15 done`
  - Both values shown, separated by `·`
  - Same clickable popover for rolling period adjustment
  - Lead time is the primary health signal for the whole board

**Column header area:** `bg-muted/30 px-3 py-2`

### Stage queues (split columns)

Stages can have a `has_queue` property. When enabled, items arriving in that stage enter a **queue sub-column** to the left of the active column — the classic Kanban "split column" pattern.

**How it works:**
- A stage with `has_queue: true` gets a virtual left half: "Queued for [Stage Name]"
- When an item transitions to a queue-enabled stage, it lands in the queue
- A user explicitly pulls it from the queue into the active stage (a micro-transition)
- This makes wait time visible — items sitting in queue are waiting, not being worked

**Visual treatment:**
- The queue sub-column appears **only when items are in it** — otherwise the stage shows as a normal single column
- Separated by a **dashed vertical line**: `border-l border-dashed border-border/50`
- Queue sub-column is narrower than the active column (~40% of total stage width)
- Queue header: no separate name — just a subtle `Q` label or no label at all (the dashed line communicates it)
- Cards in the queue appear slightly muted: `opacity-80`
- Queue cards still show all four-corner encoding

**Data model note:**
- `has_queue` is a boolean property on `blueprint.stages`
- When `has_queue` is true, items entering the stage get a sub-state of `queued`
- Pulling from queue to active is a sub-state change, not a stage transition
- WIP limits count only **active** items, not queued items (queued items are waiting, not consuming capacity)
- Stage metrics (avg time in stage) include queue wait time in the total, but the queue time vs active time breakdown is visible in the work item detail drawer

### Cancelled and Done columns

**Cancelled:** No column on the board. Cancelled items are removed from the board entirely. They are visible in search, history, and reports — but the board is for live flow only.

**Final stages (Done equivalent):** Stages can be marked `is_final: true` — this is the terminal stage of a workflow. A workflow must have at least one final stage. The board treats all final stages the same way:
- Items in final stages are visible for **7 days** by default, then auto-hidden from the board
- Configurable per org (e.g., 3 days, 14 days, 30 days)
- Hidden items are not deleted — they exist in the database and are visible in search/reports
- A small "Show all" toggle in the final column header reveals hidden items if needed
- Column count shows only visible items, with a `(+N hidden)` indicator if items are hidden
- The stage name can be anything ("Done", "Closed", "Shipped", "Resolved") — `is_final` is the structural marker
- Lead time is measured from intake to arrival in a final stage

### Service class swimlanes

Cards are organized into horizontal swimlanes by service class, ordered by priority (cost of delay):

| Order | Swimlane | Why |
|-------|----------|-----|
| 1 (top) | **Expedite** | Highest cost of delay, needs immediate visibility |
| 2 | **Fixed Date** | Date-driven urgency, second priority |
| 3 | **Standard** | Normal flow, bulk of work |
| 4 (bottom) | **Deferred** | Lowest priority, intentionally last |

**Swimlane styling:**
- Lane label: **rotated 90 degrees counter-clockwise**, positioned on the left edge of the lane
  - `text-xs font-medium text-muted-foreground uppercase tracking-wide`
  - CSS: `writing-mode: vertical-lr; transform: rotate(180deg)` (reads bottom-to-top)
  - Contained in a narrow column (`w-6`) at the left edge of the swimlane row
- Lane separator: `border-t border-border/40`
- Service class color indicator: vertical stripe or dot next to the rotated label, in the class color

**Rules:**
- Empty swimlanes are collapsed (hidden) — only show lanes that have at least one card
- Swimlane order is fixed (by `sort_order` from service_classes table) — never reordered
- Cards within a swimlane follow the existing column sort order
- The left accent border on each card still shows the service class color for reinforcement

### Cards (compact, Tufte-dense)

Cards use the **four-corner encoding** pattern — spatial position conveys meaning without labels.

**Normal card:**
```
┌──────────────────────────────────┐
│ 🐛 Title text here trun...   [C]│  ← TL: type icon  TR: assignee initial
│ 12d 4h                    1d 2h │  ← BL: total time  BR: stage time
└──────────────────────────────────┘
```

**Blocked card:**
```
┌──────────────────────────────────┐  ← border-destructive/40 (red border)
│ 🐛 Title text here trun...   [✕]│  ← TR: ✕ replaces assignee (red)
│ 12d 4h          ✕ 2d 1h   1d 2h │  ← blocked timer in red + stage time
└──────────────────────────────────┘
```

**Four corners:**
- **Top-left:** Type icon (emoji). Small (`text-sm`). Tooltip shows full type name on hover.
- **Top-right:** Assignee initial in a small circle (`w-5 h-5 rounded-full bg-muted text-xs`), or empty/no circle if unassigned. **When blocked:** replaced by `✕` in `text-destructive`.
- **Bottom-left:** Total time (time since work item entered the workflow): `12d 4h`
- **Bottom-right:** Time in current stage: `1d 2h`

**Blocked state — strong visual treatment:**
- Entire card border changes to `border-destructive/40` (thin red border all around)
- Top-right corner: `✕` icon in `text-destructive` replaces the assignee initial
- An additional **blocked timer** appears on the bottom row in `text-destructive tabular-nums`: `✕ 2d 1h` — time since the item was marked blocked
- This makes blocked items impossible to miss at a glance — three simultaneous signals (border, icon, red timer)
- Blocked items do NOT consume WIP capacity (per design constraints)

**Delayed indicator:** `◷` amber symbol appears next to the stage timer when:
- SLA exists → SLA threshold exceeded or within warning percentage
- No SLA → item has been in current stage longer than the average for that stage (computed from the same rolling window as column metrics)

**What's NOT on the card:**
- No display key (BUG.42) — visible in the drawer detail, not needed for scanning
- No "time since touched" — total time and stage time are the meaningful flow signals

**Card shape encodes org ownership:**
- **Org card:** `rounded-sm` (sharp corners) — this item belongs to an org
- **Personal card:** `rounded-lg` (rounded corners) — this is a personal/unassigned-org item
- This is a subtle but scannable distinction at the board level

**Card styling:**
- `bg-card border border-border p-2` (normal) / `border border-destructive/40` (blocked)
- Left accent border: `border-l-[3px]` colored by service class
- Title: `text-xs font-medium leading-snug` — single line, truncate with ellipsis
- Timer row: `text-xs text-muted-foreground tabular-nums`
- Total card height target: ~40-44px (2 rows of content + tight padding)
- Hover: `hover:border-primary/40`
- Click: opens work item detail in drawer

**Timer format:** `5d 3h` (compact relative). Full precision timer shown in the drawer detail view.

**Three timers on a blocked card:**
1. Total time (BL) — always present, muted
2. Blocked time (bottom center) — `text-destructive`, only when blocked
3. Stage time (BR) — always present, muted

---

## 16. Page-Specific Patterns

### Organizations
- Main content: org tree (expandable/collapsible)
- Clicking an org: opens drawer with org info (name, slug, flags) + that org's service catalog (its work item types listed)
- Tree shows: org name, child count, key behavioral flags as small indicators
- Admin actions (create org, edit) happen in the drawer

### Work Item Types
- **Non-admin view:** Search-oriented — search bar at top, results show matching types across orgs. Type a term like "jira" or "sizing" and see matching orgs + types.
- **Admin view:** Full table with create/edit in drawer. Search still available.
- Workflow should be visible in context — either a mini diagram in the drawer or a link to open the workflow in a second (stacked) drawer.

### Workflows
- Visual workflow editor as main content (existing pattern)
- Clicking a stage opens stage editor in the drawer (replaces current inline panel)
- Same drawer component as everything else
- **No WIP limits in the workflow editor** — WIP limits are org-level (set on the board column headers), not workflow-level. The workflow editor defines stages, transitions, exit criteria, and stage properties (like `has_queue`).
- Stage editor in drawer should show the `has_queue` toggle

### Reports
- Blank page with "Reports — coming soon" placeholder
- Listed in sidebar under REPORTS section

---

## 17. Transitions & Animation

- Drawer open/close: `transition-all duration-200 ease-out`
- Hover color changes: `transition-colors duration-150`
- Button press: `active:scale-[0.98] transition-transform duration-75`
- Insights bar expand/collapse: `transition-all duration-200`
- No other animations. No bouncing, sliding cards, or entrance effects.
- Board card reordering: no animation (instant DOM update)

---

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
