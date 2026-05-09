---
name: Codex Routines
description: Local command center for scheduled Codex CLI routines.
colors:
  surface: "oklch(98% 0.006 230)"
  surface-muted: "oklch(94.5% 0.01 230)"
  surface-raised: "oklch(99% 0.004 230)"
  ink: "oklch(24% 0.025 245)"
  muted: "oklch(49% 0.025 245)"
  line: "oklch(86% 0.014 230)"
  accent: "oklch(54% 0.15 153)"
  danger: "oklch(57% 0.18 29)"
  warning: "oklch(64% 0.13 75)"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: "0"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "0"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace"
    fontSize: "0.9rem"
    fontWeight: 400
    lineHeight: 1.55
rounded:
  sm: "7px"
  md: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface-raised}"
    rounded: "{rounded.md}"
    padding: "0 13px"
    height: "36px"
  button-ghost:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 13px"
    height: "36px"
  input:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 11px"
    height: "39px"
---

# Design System: Codex Routines

## 1. Overview

**Creative North Star: "The Local Runbook Console"**

Codex Routines is a restrained product interface for repeatable local automation. It should feel closer to a precise operations tool than a generic AI dashboard: dense, calm, and explicit about state. The system rejects marketing gloss, decorative AI styling, and over-composed hero surfaces.

The primary experience is task authoring and monitoring. Structure should make the currently selected routine, its schedule, its working directory, and its execution history easy to connect without forcing the user into separate pages.

**Key Characteristics:**
- Compact app shell with persistent task navigation.
- Quiet neutral surfaces with a single operational green accent.
- Logs and command output appear on demand, not as default screen noise.
- Destructive actions are visible but visually subordinate until confirmation.

## 2. Colors

The palette is a cool operational neutral system with one restrained green accent and clear semantic danger/warning states.

### Primary
- **Run Green** (`oklch(54% 0.15 153)`): primary actions, selected state, active status, and focus rings.

### Neutral
- **Work Surface** (`oklch(98% 0.006 230)`): main canvas and editor background.
- **Panel Mist** (`oklch(94.5% 0.01 230)`): sidebars, logs list, and secondary panels.
- **Raised Paper** (`oklch(99% 0.004 230)`): inputs, editor surfaces, selected tab fills.
- **Command Ink** (`oklch(24% 0.025 245)`): primary text.
- **Muted Slate** (`oklch(49% 0.025 245)`): metadata, labels, secondary copy.
- **Fine Divider** (`oklch(86% 0.014 230)`): borders and separators.

### Tertiary
- **Delete Red** (`oklch(57% 0.18 29)`): destructive actions and failed execution status.
- **Pending Amber** (`oklch(64% 0.13 75)`): running and waiting states.

### Named Rules
**The One Accent Rule.** Green is reserved for action, active state, and selection. Do not use green as background decoration.

## 3. Typography

**Display Font:** system sans
**Body Font:** system sans
**Label/Mono Font:** system sans for UI, system monospace for prompts and logs

**Character:** Native, compact, and readable. Product hierarchy comes from weight, spacing, and grouping, not display typography.

### Hierarchy
- **Title** (800, `1rem`, `1.25`): pane titles and dense section headers.
- **Body** (400, `1rem`, `1.5`): field content and readable UI copy.
- **Metadata** (400-700, `0.78rem-0.86rem`, `1.25`): timestamps, counts, labels, and secondary state.
- **Prompt Mono** (400, `0.9rem`, `1.55`): markdown editor.
- **Log Mono** (400, `0.78rem`, `1.5`): command output and stderr/stdout streams.

### Named Rules
**The No Display UI Rule.** Do not introduce decorative fonts or large hero-scale headings into the app shell.

## 4. Elevation

The system is flat by default and uses tonal layering, borders, and spacing for depth. Shadows should be rare; a local automation tool should not feel like floating marketing cards.

### Named Rules
**The Surface Stack Rule.** Depth is created with background tone changes first, borders second, and shadow only for temporary overlays.

## 5. Components

### Buttons
- **Shape:** compact rounded rectangle, 8px radius.
- **Primary:** green fill, white-tinted text, 36px minimum height.
- **Ghost:** neutral fill with border for secondary actions.
- **Danger:** red text and red-tinted border, never full red unless confirming deletion.
- **Hover / Focus:** subtle tonal shift and visible focus ring using Run Green.

### Chips
- **Style:** small rounded status pills for active, paused, running, success, and failed.
- **State:** include text and icon where space allows; never rely on color alone.

### Cards / Containers
- **Corner Style:** 8px radius for list rows, editors, controls, and panels.
- **Background:** panel surfaces use tonal layers rather than floating cards.
- **Shadow Strategy:** no shadow at rest.
- **Border:** 1px Fine Divider for separation.
- **Internal Padding:** 12px to 16px, with 4pt scale increments.

### Inputs / Fields
- **Style:** raised neutral background, 1px border, 8px radius.
- **Focus:** green border and soft green outline.
- **Disabled:** lower opacity and muted text, with cursor feedback.

### Navigation
- **Style:** left task sidebar remains visible on desktop. Selected and active states should be visually distinct. On mobile, panels stack vertically with logs hidden until explicitly opened.

### Prompt And Log Surfaces
- **Prompt Editor:** plain monospace surface with toolbar and preview toggle.
- **Log Viewer:** dark command-output surface opened on demand, scoped to the selected task.

## 6. Do's and Don'ts

### Do:
- **Do** keep the task, schedule, prompt, and logs visually connected.
- **Do** show active, paused, running, success, and failed states with both text and color.
- **Do** keep logs hidden until requested.
- **Do** use inline confirmation for deletion instead of browser dialogs.
- **Do** reserve Run Green for primary action, selection, and active status.

### Don't:
- **Don't** use purple-blue AI gradients, neon terminal styling, decorative glass panels, or marketing-dashboard gloss.
- **Don't** make logs a permanent third column by default.
- **Don't** hide destructive actions behind hover-only behavior.
- **Don't** use colored side stripes, gradient text, nested cards, or modal-first flows.
- **Don't** add a manual refresh button; the app refreshes itself.
