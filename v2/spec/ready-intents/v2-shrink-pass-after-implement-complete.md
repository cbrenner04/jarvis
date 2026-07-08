---
name: v2-shrink-pass-after-implement-complete
---

# Shrink runs automatically after implement completes

An `implement` write step reaching `complete` triggers one bounded shrink
write-loop pass before the workflow advances — without shrink appearing as a
preset step.

## Decisions

- Trigger is the same completion-boundary hook v1 patch uses: implement
  `complete` only — not `budget-soft-stopped`, `blocked`, or
  `invocation_failure`.
- Workflow presets list only the `implement` write step; the workflow runner
  (or the write-loop completion hook it calls) invokes the shrink pass, not a
  new preset entry.
- Shrink pass is one bounded write-loop-style invocation using `role: shrink`,
  the existing shrink prompt id (v1 artifact or v2 equivalent), and the same
  worktree/spec context as the implement step just completed. Reuses
  `executeWrite` / step-runner path — no parallel shrink implementation.
- Shrink attempts are attributable: telemetry records `role: shrink` on a
  distinct binding chain. Whether shrink gets its own `stepId` or rides under
  implement's run is an implementation choice; no separate workflow step row
  is required in daemon/TUI for this slice.
- Docs: `workflow-runner.md`, `write-behavior.md`.

## Out of scope

- Shrink as an explicit preset step or human gate.
- Mid-implement shrink (post-complete only).
- Daemon/TUI surfacing shrink as its own step row.

## Prerequisites

- `shrink` is a valid role with its own resolved `(agent, role) → rungs`.
- Workflow runner dispatches `write` steps with role→model resolution.
- Write loop reaches terminal `complete` with contract check.
