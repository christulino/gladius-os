# The Drawer

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
