---
name: tui-run-launch
---

# TUI run launch

Operator starts a detached write-loop run from the interactive UI. Collects required `WriteLoopInput` fields, calls daemon `start`, surfaces run ID and admission-guard errors.

Source: Phase 4 in `v2/docs/v2-build-order.md`. Done condition is merged code in `v2/src`, not this intent.

## Scope

- Interactive form or prompt flow for required run fields (same contract as `jarvis run start`).
- Daemon `start` RPC round-trip; display returned run ID.
- Surface `run_in_progress` and `worktree_claimed` guard failures as actionable operator messages.
- Co-located tests with injectable IPC client.

## Out of scope

- Live status polling, outcome wait, log tail, pause/resume/kill.
- Workflow presets, natural-language router, multi-step workflows.
- Changing daemon start guards or `WriteLoopInput` shape.

## Decisions

- Launch maps to daemon `start` only — rules out foreground in-process `jarvis write` from the TUI.
- Required fields mirror `jarvis run start` — rules out inventing a parallel input contract.
- Deferred to first consumer: form layout, defaults, and field-validation UX — pin in refine.

## Documentation updates

- Operator-facing v2 doc home — document TUI run launch once command UX settles.

## Prerequisites

- TUI entry command connects to the daemon at the production socket
- Daemon `start` RPC spawns a background write loop and returns a run ID
