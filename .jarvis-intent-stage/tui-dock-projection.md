---
name: tui-dock-projection
---

# Pure four-line command dock

## Problem

Dock content is hardcoded in the ink renderer, omits daemon identity and errors, and cannot show command state or contextual hints through a CI-observable function.

## Decisions

- Project all dock content from `TuiMonitorState` through a pure function in `tui-monitor-lines.ts` — rules out ink-owned content and a third rendering convention.
- Store buffer, cursor, focus, and last command result/error on `TuiMonitorState` — rules out hidden widget state tests cannot inspect.
- Keep exactly four painted rows in split and stacked layouts — rules out terminal-height changes when input is empty or long.
- Show active pipeline count, machine profile/socket digest, refresh interval, and last RPC error on the status row — rules out the current live-run-only status.
- Window long input across the prompt row and one continuation row without mutating the buffer — rules out dock growth or destructive truncation.
- Derive hints from the current selection and focus — rules out static hints that advertise inapplicable actions.

## Acceptance criteria

- [ ] A pure function maps monitor state to four rows: status, prompted input with visible cursor, continuation, and selection-contextual hints.
- [ ] Status covers active pipeline count, daemon profile/socket digest, refresh interval, and the last RPC error when present.
- [ ] Input exceeding one display row uses the continuation row while the underlying buffer remains unchanged.
- [ ] Empty and long input both render exactly four dock rows in split and stacked shell layouts.
- [ ] `createMonitorDisplay` paints only the pure dock projection; a `tui-monitor-lines.test.ts` projection test fails against the hardcoded baseline.
- [ ] Added projection guards have `// @mutate` checkpoints on their real source conditions; no production inversion hooks are added.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — document the four dock rows and status fields.
- `v2/docs/v1-behaviors.md` — record the state-driven four-line dock.

## Prerequisites

- A reusable detached pipeline-start admission API returns an admitted pipeline id or named failure without waiting.
- The CLI preserves its existing attached and detached behavior around that admission API.
- A pure parser returns typed `start`, `expand`, and `collapse` commands plus named parse and recognized-unavailable errors.
- Recognized unavailable verbs name their existing CLI equivalents without runtime planning labels.
