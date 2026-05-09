# Product

## Register

product

## Users

Codex Routines is used by a local developer or operator who wants Codex jobs to run on a schedule without babysitting the terminal. The user is usually working in a repository, preparing repeatable maintenance prompts, checking whether a job is active, and reviewing logs after a run.

## Product Purpose

The product schedules and runs Codex CLI tasks from a chosen working directory, using markdown prompts and persistent local execution history. Success means the user can see what will run, where it will run, when it will run next, and what happened last, without needing to inspect files or terminal processes.

## Brand Personality

Quiet, operational, precise. The interface should feel like a focused dark control room for local automation: confident enough to handle dangerous Codex execution, but restrained enough that the prompt and logs remain the center of attention.

## Anti-references

Avoid marketing-dashboard gloss, oversized hero sections, neon terminal drama, purple-blue AI gradients, decorative glass panels, busy cards, and hidden destructive actions. Avoid modal-first flows for routine operations; prefer inline confirmation and clear local state.

## Design Principles

1. Make state visible before action: active, paused, next run, last run, and running states should be obvious at a glance.
2. Keep dangerous controls explicit: destructive and bypass-sandbox behavior must be visible, specific, and never decorative.
3. Preserve work context: task selection, execution path, schedule, prompt, and logs should stay mentally connected.
4. Prefer operational density: give repeated users fast scanning and short paths over onboarding copy.
5. Let logs stay secondary until needed: the main surface is task authoring; execution detail should open on demand.

## Accessibility & Inclusion

Target WCAG AA contrast for text and controls. Support keyboard navigation, visible focus states, reduced-motion preferences, 44px touch targets on mobile, and non-color indicators for status. Do not rely on hover-only controls for destructive or primary actions.
