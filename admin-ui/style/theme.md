# Theme & Colors

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
