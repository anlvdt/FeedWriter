# FeedWriter UI System v3

**Design base:** [Violet Issue](https://designmd.ai/chef/violet-issue) (MIT)  
**Primary accent:** Linear violet `#5E6AD2` · hover `#4E5BBF`  
**Source of truth:** `DESIGN.md`

## Tokens (dark)

| Layer | Hex | CSS |
|-------|-----|-----|
| L0 Background | soft-dark `#18181F` · soft-light `#E8E8EE` | `--bg` / `--fw-bg` |
| L1 Card | `#22222E` · `#F2F2F6` | `--bg-card` / `--fw-surface` |
| L2 Elevated | `#2A2A38` · `#E2E2EA` | `--bg-hover` / `--fw-surface-2` |
| L3 Nest | `#323242` · `#F6F6FA` | `--bg-nest` / `--fw-elevated` |
| Border | `#353545` · `#D0D0DA` | `--border` / `--fw-border` |
| Text | `#E8E8ED`/`#9A9EAB` · `#2A2A32`/`#5C5C6A` | primary / secondary |
| Accent | `#5E6AD2` · hover `#4E5BBF` | CTA, focus, active only |
| Soft | `rgba(94,106,210,0.12)` | selected / ring fill |
| Danger | `#EB5757` | errors |
| Success | `#3DD68C` | OK states |
| Warning | `#F0C000` | caution |

## Rules

1. Accent is **never** a large fill — only CTA, focus, active chip.
2. Depth via **surface layering**, not heavy shadows (modals: `0 24px 48px rgba(0,0,0,0.4)`).
3. Compact controls: **32px** default, **28px** compact, **36px** list rows.
4. Radius: 4 chips · 6 buttons/inputs · 8 cards · 12 modals · pill pills.
5. Transitions ≤ **150ms**.
6. Vietnamese: line-height ≥ 1.45, no ellipsis on UI labels.
7. One primary button per region.

## Files

| File | Role |
|------|------|
| `DESIGN.md` | Full system + credit |
| `popup.css` | Extension popup |
| `ui.css` | Overlay panel / toolbar / composer |
| `translate.css` | EN→VI tooltip |
| `content.css` | FB surface tokens |

## Surfaces

- **Popup** — tabs, settings, keys, history, sticky save  
- **Feed chip** — 32px host, neutral pill  
- **Result panel** — header · body · tone · footer  
- **Composer** — source card + quality badge  
- **Translate** — L3 nest surface  
- **Floating toolbar** — compact ghost + one highlight  

## Verify

1. Reload extension · hard-refresh FB  
2. Popup dark ladder matches `#101014` / `#1B1B25`  
3. Focus ring violet soft `rgba(94,106,210,0.15)`  
4. Primary buttons `#5E6AD2`; tabs **not** solid violet wash  
5. Tooltip nest surface `#252536`  
