# Typography

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
