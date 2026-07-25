# FeedWriter UI — Violet Issue (designmd.ai)

> Source: [Violet Issue @ designmd.ai](https://designmd.ai/chef/violet-issue) (MIT)  
> FeedWriter uses the **full Violet Issue palette**, including Linear violet primary **`#8B93F7`** (rich).

## Overview

Violet Issue is a precision-engineered design system for dense, keyboard-driven tools on deep dark surfaces. FeedWriter applies the same **dark ladder, compact heights (28–36px), Inter type, layering-over-shadows, and violet accent** for:

- Extension popup (~380px)
- Facebook overlay panel
- Floating toolbar / translate tooltip

## Colors

| Token | Hex | Use |
|-------|-----|-----|
| Background (L0) | `#16161D` soft-dark · `#E0E0E8` soft-light | Canvas |
| Neutral (L1 card) | `#252532` · `#FAFAFC` | Cards (clear step vs canvas) |
| Surface (L2) | `#303042` · `#ECECF4` | Hover / elevated |
| Surface nest (L3) | `#35354A` · `#FFFFFF` | Tooltips / nest |
| Text primary | `#F5F5F7` · `#1A1A22` | Body (high contrast) |
| Text secondary | `#B4B8C4` · `#4A4A58` | Meta ≥ readable |
| Border | `#4A4A60` · `#B8B8C8` | Visible edges |
| **Primary** | **`#8B93F7`** (rich) | CTA, focus, active |
| **Primary hover** | **`#9AA1FF`** / **`#4A4ED4`** | Hover/pressed |
| **Primary soft** | **`rgba(94,106,210,0.12)`** | Selected row, focus ring fill |
| Success | `#3DD68C` | OK / connected |
| Warning | `#F0C000` | Caution |
| Error | `#EB5757` | Destructive / fail |

### Rules (Violet Issue)

- Do **not** use primary as a large surface fill — accent only.
- Prefer **background-color layering** over heavy shadows.
- Focus ring: 1px primary border + `0 0 0 2px` primary-soft (`rgba(94,106,210,0.15)`).
- Modal shadow only when needed: `0 24px 48px rgba(0,0,0,0.4)`.
- Soft glow behind focused elements: `0 0 24px rgba(94,106,210,0.15)`.

## Typography

- UI: **Inter** 400 / 500 / 600
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
| **Primary button** | 32px · violet `#5E6AD2` · radius 6 · weight 500–600 · hover `#4E5BBF` |
| **Compact / secondary** | **28px** · transparent + border |
| **Inputs / selects** | **32px** · radius 6 · focus ring soft violet |
| **History list** | Seamless list · row **min 36px** · title 14/500 clamp 1 · meta 12px |
| **Key rows** | **36px** · mono 12px · status chip 20px |
| **Tabs** | **32px** · active elevated surface, no solid primary wash |
| **Chips / badges / kbd** | **20px** · radius 4 (kbd pill) |
| **Panel tool buttons** | 28px compact |
| **Panel primary (Copy/Đăng)** | 32px violet |
| **Floating toolbar btn** | 28px |
| **Overlay panel** | bg L0 · head/footer L1 |
| **Tooltip** | L3 nest `#252536` |

## Do's and Don'ts

- Do keep one primary CTA per region (Save / Đăng status)
- Do keyboard affordances (shortcuts, Escape, tab arrows)
- Don't flood UI with violet as large fills
- Don't use animations > 150ms
- Don't crop Vietnamese labels (overflow visible + wrap)

## Files

| File | Role |
|------|------|
| `DESIGN.md` | This document (agent + human source of truth) |
| `vendor/violet-issue-DESIGN.md` | Upstream Violet Issue (verbatim) |
| `popup.css` | Extension popup tokens |
| `ui.css` | Overlay / FB panel tokens (`--fw-*`) |
| `translate.css` | Translate tooltip |
| `content.css` | Legacy + shared FB surface tokens (`--fbs-*`) |
| `UI_SYSTEM_V3.md` | Surface map + verify checklist |

## Credit

Violet Issue by @chef on [designmd.ai](https://designmd.ai/chef/violet-issue) — MIT.
