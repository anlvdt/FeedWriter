# FeedWriter UI — Editorial Ink

> Light-first writing-tool system for FeedWriter. Teal-ink accent **`#0F766E`**; cool paper surfaces; no violet glow.

## Overview

Editorial Ink is a dense, readable UI for daily feed summarization:

- Extension popup (~380px) — **light default**
- Facebook overlay panel / composer
- Floating toolbar / translate tooltip / feed chips

Dark mode remains for Facebook dark feed and user preference (`theme: dark` / `auto`).

## Colors

| Token | Light (identity) | Dark | Use |
|-------|------------------|------|-----|
| Background (L0) | `#EEF2F5` | `#12171C` | Canvas |
| Neutral (L1 card) | `#FFFFFF` | `#1A2229` | Cards |
| Surface (L2) | `#E4EAEF` | `#243039` | Hover / elevated |
| Surface nest (L3) | `#FFFFFF` | `#2A343D` | Tooltips / nest |
| Text primary | `#0F1419` | `#EEF2F5` | Body |
| Text secondary | `#3D4A57` | `#A8B4C0` | Meta |
| Text muted | `#5C6B7A` | `#7A8794` | Hints |
| Border | `#C5CDD6` | `#3A4652` | Edges |
| Border strong | `#8A97A6` | `#5A6A78` | Hover edges |
| **Primary** | **`#0F766E`** | **`#2DD4BF`** | CTA, focus, active |
| **Primary hover** | **`#0D5F58`** | **`#5EEAD4`** | Hover/pressed |
| **Primary soft** | `rgba(15,118,110,0.14)` | `rgba(45,212,191,0.18)` | Selected / ring |
| Success | `#166534` / `#3DD68C` | OK |
| Warning | `#92400E` / `#F0C000` | Caution |
| Error | `#B91C1C` / `#EB5757` | Fail |

### Rules

- Do **not** use primary as a large surface fill — accent only.
- Prefer **background-color layering** over heavy shadows.
- Focus ring: 1px primary border + `0 0 0 2px` primary-soft.
- Modal shadow only when needed: `0 24px 48px rgba(0,0,0,0.4)` (dark) / soft cool shadow (light).
- No purple / violet accents or purple glows.
- Popup canvas: soft cool paper gradient (not flat cream `#F4F1EA`).

## Typography

- UI: system sans (`ui-sans-serif`, Segoe UI, Helvetica Neue) 400 / 500 / 600
- Brand / titles: serif stack — `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`
- Mono: **ui-monospace / JetBrains Mono** for keys, shortcuts, IDs
- Scale (popup / dense UI): 11 · 12 · 13 · 14 · 15–16 panel title
- Line-height body ≥ **1.45** (Vietnamese diacritics)
- Transitions ≤ **150ms**

## Spacing

Base **4px**: 2, 4, 8, 12, 16, 20, 24, 32…

- Buttons: padding ~4×12, height **32px** default / **28px** compact
- Rows (history/keys): **36px** min
- Cards: padding 12–16px

## Radius

| Token | px | Use |
|-------|-----|-----|
| sm | 4 | Chips, badges |
| md | 6 | Buttons, inputs |
| lg | 8 | Cards, nav items |
| xl | 12 | Modals, popup panels |
| pill | 9999 | Tabs active, status pills |

## Components — density locked

| Component | Spec |
|-----------|------|
| **Primary button** | 32px · teal `#0F766E` · radius 6 · weight 500–600 |
| **Compact / secondary** | **28px** · transparent + border |
| **Inputs / selects** | **32px** · radius 6 · teal soft focus ring |
| **History list** | Seamless list · row **min 36px** · title 14/500 clamp 1 · meta 12px |
| **Key rows** | **36px** · mono 12px · status chip 20px |
| **Tabs** | **32px** · active elevated paper surface, no solid accent wash |
| **Chips / badges / kbd** | **20px** · radius 4 |
| **Panel tool buttons** | 28px compact |
| **Panel primary (Copy/Đăng)** | 32px teal |
| **Floating toolbar btn** | 28px |
| **Feed chip** | Neutral ink border resting; teal on hover/active |
| **Overlay panel** | bg L0 · head/footer L1 |
| **Tooltip** | L3 nest |

## Do's and Don'ts

- Do keep one primary CTA per region (Save / Đăng status)
- Do keyboard affordances (shortcuts, Escape, tab arrows)
- Don't use violet / purple fills or glows
- Don't use animations > 150ms
- Don't crop Vietnamese labels (overflow visible + wrap)
- When changing light theme tokens, **re-bind all popup aliases** (`--bg`, `--text`, …) on `body.light` — `:root` resolves `var(--fw-*)` to concrete values that otherwise stick

## Files

| File | Role |
|------|------|
| `DESIGN.md` | This document (agent + human source of truth) |
| `vendor/violet-issue-DESIGN.md` | Archived upstream (not active) |
| `popup.css` | Extension popup — aliases `--bg` → `--fw-*` |
| `ui.css` | Overlay / FB panel — canonical `--fw-*` |
| `translate.css` | Translate tooltip → `--fw-*` |
| `content.css` | FB helpers — `--fbs-*` aliases to `--fw-*` |
| `UI_SYSTEM_V3.md` | Surface map + verify checklist |
