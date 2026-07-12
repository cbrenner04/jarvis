# TUI is not usable as an operator monitor

`jarvis tui` renders `monitorTextLines` — an undifferentiated flat list of plain
`Text` lines (`v2/src/tui/tui-monitor-lines.ts`, `tui-ink-monitor.tsx`). In real
dogfooding it tells the operator almost nothing.

## Problem

- **No ordering.** Runs render newest-first regardless of status, so live work is
  buried under a growing wall of terminal runs. The one thing an operator wants —
  what is running right now — is not at the top.
- **No retention/cleanup.** Every run ever started stays in the list forever.
  There is no way to retire completed/failed/killed runs from the monitor.
- **No row navigation.** Selection is pinned to the first selectable row on entry.
  `a` / `v` / `k` act on "the selected run", but nothing can move the selection,
  so steering keys are effectively dead for any run but one.
- **No color.** `status` and `liveness` are plain text, so `failed`, `in-progress`,
  and `completed` are visually identical.

## Scope

- Sort/group the run table so `in-progress` (and other active states) sit at the
  top; terminal runs below.
- Row keybindings: up/down (and `j`/`k`-style equivalents where they don't collide
  with the existing `k` = kill binding) move the selection; the `wait` subscription
  follows the newly selected run.
- Color the `status` and `liveness` cells by state (active / terminal-success /
  terminal-failure), using ink `Text` color props.
- Retire terminal runs from the monitor. Prefer folding into an **existing**
  surface rather than adding a new command — see Decisions.

## Decisions

- Retention is **daemon-side**: terminal runs age out of `list` after a bound
  (count or age), so `jarvis run list` and the TUI both benefit and the TUI stays
  a pure renderer. Rejected: a TUI-local hide key (view-only, leaves `run list`
  broken) and a new `cleanup` subcommand (a new command where an existing surface
  suffices).
- Keybindings must not break the existing `q` / `a` / `v` / `k` / revise-compose
  contract.

## Out of scope

- Log-follow TUI (`jarvis tui log`) changes.
- Workflow step-detail panels beyond what already renders.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` — `jarvis tui` section: ordering, keys, color.
- `v2/docs/daemon-host.md` — only if retention lands daemon-side (option B/C).
