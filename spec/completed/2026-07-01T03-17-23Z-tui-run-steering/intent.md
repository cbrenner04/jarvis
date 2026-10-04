---
name: tui-run-steering
---

# TUI run steering

Operator pauses, resumes, or kills the selected active run from the interactive UI. Steering vocabulary matches the daemon API — no richer controls.

Source: Phase 4 in `v2/docs/v2-build-order.md`; Steering in `v2/docs/v2-architecture.md` and `v2/docs/daemon-host.md`. Done condition is merged code in `v2/src`, not this intent.

## Scope

- Select an active run from the monitored list.
- Pause, resume, and kill actions map to daemon RPCs with existing semantics.
- Surface RPC errors (`unknown_run`, `terminal_run`, guard violations) as actionable messages.
- Co-located tests with injectable IPC client.

## Out of scope

- Launch, log tail, outcome layout, human-loop approve/revise (Phase 6).
- Richer steering (edit spec mid-run, inject messages, reorder steps).
- Changing pause/resume/kill server semantics.

## Decisions

- Steering surface is pause/resume/kill only — rules out inventing controls no daemon verb supports.
- Kill is immediate; pause is graceful at iteration boundary — rules out remapping semantics in the UI layer.
- Deferred to first consumer: control placement and confirmation UX — pin in refine.

## Documentation updates

- Operator-facing v2 doc home — document TUI steering actions once UX settles.

## Prerequisites

- TUI displays runs with live status and liveness from daemon `list`
- Daemon `pause`, `resume`, and `kill` RPCs enforce graceful pause and immediate kill semantics
