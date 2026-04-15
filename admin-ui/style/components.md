# Components

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
