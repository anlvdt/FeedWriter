# FeedWriter UI System v3 — Editorial Ink

**Design base:** Editorial Ink (see `DESIGN.md`)  
**Primary accent:** `#0F766E` (light) · `#2DD4BF` (dark)  
**Source of truth:** `DESIGN.md`

## Tokens

| Layer | Light | Dark | CSS |
|-------|-------|------|-----|
| L0 Background | `#EEF2F5` | `#12171C` | `--fw-bg` / `--bg` |
| L1 Card | `#FFFFFF` | `#1A2229` | `--fw-surface` / `--bg-card` |
| L2 Elevated | `#E4EAEF` | `#243039` | `--fw-surface-2` / `--bg-hover` |
| L3 Nest | `#FFFFFF` | `#2A343D` | `--fw-elevated` / `--bg-nest` |
| Border | `#C5CDD6` | `#3A4652` | `--fw-border` / `--border` |
| Text | `#0F1419` / `#3D4A57` | `#EEF2F5` / `#A8B4C0` | `--fw-text` / `--fw-text-2` |
| Accent | `#0F766E` · hover `#0D5F58` | `#2DD4BF` · hover `#5EEAD4` | CTA, focus, active only |
| Soft | `rgba(15,118,110,0.14)` | `rgba(45,212,191,0.18)` | selected / ring fill |
| Danger | `#B91C1C` / `#EB5757` | errors |
| Success | `#166534` / `#3DD68C` | OK states |
| Warning | `#92400E` / `#F0C000` | caution |

## Rules

1. Accent is **never** a large fill — only CTA, focus, active chip.
2. Depth via **surface layering**, not heavy shadows.
3. Compact controls: **32px** default, **28px** compact, **36px** list rows.
4. Radius: 4 chips · 6 buttons/inputs · 8 cards · 12 modals · pill pills.
5. Transitions ≤ **150ms**.
6. Vietnamese: line-height ≥ 1.45, meta ≥ 11px, no ellipsis on UI labels.
7. One primary button per region.
8. Canonical tokens are `--fw-*`. Popup `--bg`/`--accent` and content `--fbs-*` alias to them.
9. Popup default theme is **light**; dark `:root` remains for dark preference / FB dark.

## Files

| File | Role |
|------|------|
| `DESIGN.md` | Full system |
| `popup.css` | Extension popup (aliases → `--fw-*`) |
| `ui.css` | Overlay panel / toolbar / composer (`--fw-*`) |
| `translate.css` | EN→VI tooltip |
| `content.css` | FB helpers (`--fbs-*` → `--fw-*`) |

## Surfaces

- **Popup** — tabs, settings, keys, history, sticky save  
- **Feed chip** — 28–32px host, neutral pill, `right: 104px`  
- **Result panel** — header · body · tone · footer  
- **Composer** — source card + quality badge  
- **Translate** — L3 nest surface  
- **Floating toolbar** — compact primary + overflow  

## Verify

1. Reload extension · hard-refresh FB  
2. Popup light canvas `#EEF2F5` / cards white; dark `#12171C` / `#1A2229`  
3. Focus ring teal soft `rgba(15,118,110,0.14)` (light)  
4. Primary buttons `#0F766E` (light) / `#2DD4BF` (dark); tabs **not** solid accent wash  
5. Chip host clears FB top-right controls (`right: 104px`)  
6. Mobile panel is a bottom sheet with safe-area padding  
7. Inputs readable in light + dark (no white-on-white)  
