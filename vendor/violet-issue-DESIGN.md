# Violet Issue

## Overview
Violet Issue is a precision-engineered design system for issue tracking and project management tools. Built around a distinctive violet accent on deep dark surfaces, it prioritizes speed, keyboard-driven workflows, and information density. The aesthetic is dark, focused, and engineered for developers who spend hours in the interface every day.

## Colors
- **Primary** (#5E6AD2): Primary actions, selected states, active indicators, focus rings — Linear Violet
- **Primary Hover** (#4E5BBF): Hover/pressed state for primary interactions — Deep Violet
- **Secondary** (#6E79D6): Secondary highlights, hover accents, gradient endpoints — Light Violet
- **Neutral** (#1B1B25): Card backgrounds, sidebar panels — Dark Charcoal
- **Background** (#101014): App background, deepest layer — Near Black
- **Surface** (#1F1F2E): Elevated panels, modals, dropdown backgrounds — Dark Surface
- **Text Primary** (#F1F1F4): Headings, primary text, issue titles — Off White
- **Text Secondary** (#8A8F98): Descriptions, metadata, timestamps, placeholders — Muted Gray
- **Border** (#2C2C3A): Subtle dividers, input borders, panel edges — Dark Border
- **Success** (#3DD68C): Completed issues, done status, passing checks — Emerald
- **Warning** (#F0C000): In-progress status, attention needed, snoozed — Gold
- **Error** (#EB5757): Urgent priority, bugs, cancelled status — Coral Red

## Typography
- **Display Font**: Inter — loaded from Google Fonts
- **Body Font**: Inter — loaded from Google Fonts
- **Code Font**: JetBrains Mono — loaded from Google Fonts

Inter is the sole UI font, used at weights 400, 500, and 600. Display headings use 600 weight with -0.03em letter-spacing for a tight, dense appearance. Body text uses 400 weight at 1.5 line-height. Issue titles in lists use 500 weight at 14px for scanability. Status labels and metadata use 500 weight at 12px. Keyboard shortcut hints use JetBrains Mono at 11px within 20px rounded containers. The system is optimized for 14px base size, where Inter renders with maximum clarity.

Type scale: 11px (shortcut hints/overline), 12px (metadata/labels), 13px (small body/nav), 14px (body/issue title), 16px (h5/panel title), 20px (h4/view title), 24px (h3/page title), 32px (h2/settings), 40px (h1/landing).

## Elevation
The dark interface uses layered backgrounds rather than traditional shadows. Level 0 is the base (#101014). Level 1 (#1B1B25) is the sidebar and card surface. Level 2 (#1F1F2E) is for dropdowns, command palettes, and modals. Level 3 (#252536) is for nested popovers and tooltips. Modals use a subtle `0 24px 48px rgba(0,0,0,0.4)` shadow combined with a backdrop blur of 4px. The violet primary (#5E6AD2) appears as a soft glow (`0 0 24px rgba(94,106,210,0.15)`) behind focused elements and selected list items.

## Components
- **Buttons**: Primary — #5E6AD2 background, white text, 500 weight, 28px height (compact) / 32px (default), 12px horizontal padding, 6px border-radius. Hover #4E5BBF. Secondary — transparent, 1px #2C2C3A border, #F1F1F4 text, hover border #8A8F98. Ghost — transparent, #8A8F98 text, hover #F1F1F4 text with #1F1F2E bg. Compact sizes throughout for toolbar density. All buttons 13px Inter 500.
- **Cards**: #1B1B25 background, 1px #2C2C3A border, 8px border-radius. No shadow on cards. Padding 12px 16px. Issue cards are row-based, not traditional cards — 36px height rows with inline status icon, priority indicator, identifier (12px JetBrains Mono #8A8F98), title (14px/500 #F1F1F4), labels (chips), and assignee avatar.
- **Inputs**: 32px height, #1B1B25 background, 1px #2C2C3A border, 6px border-radius, 14px Inter 400, #F1F1F4 text, #8A8F98 placeholder. Focus shows 1px #5E6AD2 border with `0 0 0 2px rgba(94,106,210,0.15)` ring. Compact variant at 28px height for toolbar and filter inputs.
- **Chips**: 20px height, 4px border-radius, 11px font, 500 weight. Priority chips: Urgent (#EB5757 bg/20%, #EB5757 text), High (#F7953D bg/20%, #F7953D text), Medium (#F0C000 bg/20%, #F0C000 text), Low (#8A8F98 bg/15%, #8A8F98 text). Label chips use custom colors with 15% opacity background.
- **Lists**: Issue lists use 36px row height, full-width, no visible borders between rows. Hover reveals #1F1F2E background. Selected row shows #5E6AD2 at 10% opacity background with left 2px #5E6AD2 border. Row contents: status circle (12px), priority icon (16px), identifier, title, labels, assignee — all inline. Group headers use 11px/600 uppercase #8A8F98 with 0.05em tracking.
- **Checkboxes**: Circular status indicators instead of squares. 14px circle, 1.5px #8A8F98 border. States: Backlog (dotted outline), Todo (solid outline), In Progress (half-filled #F0C000), Done (filled #3DD68C with checkmark), Cancelled (filled #8A8F98 with line-through).
- **Tooltips**: #252536 background, 1px #2C2C3A border, #F1F1F4 text, 12px/400, 6px border-radius, 6px 10px padding. Shows keyboard shortcut right-aligned in JetBrains Mono #8A8F98. 0ms delay (instant), 100ms fade-in.
- **Navigation**: Left sidebar, 220px width (collapsible to 48px), #1B1B25 background with right 1px #2C2C3A border. Workspace switcher at top. Nav items 13px/500 #8A8F98, 32px height, 8px border-radius. Hover #1F1F2E. Active item #5E6AD2 at 10% bg with #F1F1F4 text. Team sections collapsible. Bottom: settings, help, keyboard shortcut reference.
- **Search**: Command palette (Cmd+K): centered, 560px wide, #1F1F2E background, 1px #2C2C3A border, 12px border-radius, `0 24px 48px rgba(0,0,0,0.4)` shadow + backdrop blur. Search input 44px, no border, 16px Inter 400. Results grouped by category (issues, projects, actions) with 36px row height. Keyboard navigation with #5E6AD2/10% highlight.

## Spacing
- Base unit: 4px
- Scale: 2px, 4px, 8px, 12px, 16px, 20px, 24px, 32px, 40px, 48px, 64px
- Component padding: Buttons 4px 12px, cards/rows 8px 16px, inputs 4px 10px, chips 2px 8px
- Section spacing: 32px between view sections, 16px between issue groups
- Container max width: Full viewport width (sidebar + main + optional detail panel)
- Card grid gap: 0px between issue rows (seamless list), 8px between board column cards

## Border Radius
- 4px: Chips, inline labels, small badges
- 6px: Buttons, inputs, dropdown items
- 8px: Cards, panels, sidebar nav items, dropdown menus
- 12px: Modals, command palette, settings panels
- 9999px: Status circles, avatar circles, keyboard shortcut containers

## Do's and Don'ts
- Do design every interaction to be keyboard-accessible with visible shortcut hints
- Do use the command palette as the primary navigation pattern — not just a search tool
- Don't use heavy shadows; rely on background-color layering for depth on dark surfaces
- Do keep component heights compact (28-36px) to maximize visible information density
- Don't use animations longer than 150ms; transitions should feel snappy, not decorative
- Do display issue identifiers in monospace to visually distinguish them from titles
- Don't use the violet as a background fill for large areas; it is strictly an accent color
- Do provide hover states that respond within 50ms for an ultra-responsive feel
- Don't introduce warm colors into the palette; the system is deliberately cool-toned
- Do support multiple views (list, board, timeline) of the same data with consistent styling