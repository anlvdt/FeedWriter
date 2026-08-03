# FeedWriter UI System v3

**Design base:** [Violet Issue](https://designmd.ai/chef/violet-issue) (MIT)  
**Primary accent:** `#8B93F7` · hover `#9AA1FF`  
**Source of truth:** `DESIGN.md`

## Tokens (dark)

| Layer | Hex | CSS |
|-------|-----|-----|
| L0 Background | soft-dark `#16161D` · soft-light `#E0E0E8` | `--fw-bg` / `--bg` |
| L1 Card | `#252532` · `#FAFAFC` | `--fw-surface` / `--bg-card` |
| L2 Elevated | `#303042` · `#ECECF4` | `--fw-surface-2` / `--bg-hover` |
| L3 Nest | `#35354A` · `#FFFFFF` | `--fw-elevated` / `--bg-nest` |
| Border | `#4A4A60` · `#B8B8C8` | `--fw-border` / `--border` |
| Text | `#F5F5F7` / `#B4B8C4` | `--fw-text` / `--fw-text-2` |
| Accent | `#8B93F7` · hover `#9AA1FF` | CTA, focus, active only |
| Soft | `rgba(139,147,247,0.22)` | selected / ring fill |
| Danger | `#EB5757` | errors |
| Success | `#3DD68C` | OK states |
| Warning | `#F0C000` | caution |

## Rules

1. Accent is **never** a large fill — only CTA, focus, active chip.
2. Depth via **surface layering**, not heavy shadows (modals: `0 24px 48px rgba(0,0,0,0.4)`).
3. Compact controls: **32px** default, **28px** compact, **36px** list rows.
4. Radius: 4 chips · 6 buttons/inputs · 8 cards · 12 modals · pill pills.
5. Transitions ≤ **150ms**.
6. Vietnamese: line-height ≥ 1.45, meta ≥ 11px, no ellipsis on UI labels.
7. One primary button per region.
8. Canonical tokens are `--fw-*`. Popup `--bg`/`--accent` and content `--fbs-*` alias to them.

## Files

| File | Role |
|------|------|
| `DESIGN.md` | Full system + credit |
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
2. Popup dark ladder matches `#16161D` / `#252532`  
3. Focus ring violet soft `rgba(139,147,247,0.22)`  
4. Primary buttons `#8B93F7`; tabs **not** solid violet wash  
5. Chip host clears FB top-right controls (`right: 104px`)  
6. Mobile panel is a bottom sheet with safe-area padding  
