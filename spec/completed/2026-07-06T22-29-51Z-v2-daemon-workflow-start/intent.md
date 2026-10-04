---
name: v2-daemon-workflow-start
---

# Daemon `start` accepts a workflow, not just a bare write loop

Extend the daemon's `start` RPC so a caller can launch an ordered multi-step workflow (`executeWorkflow` over `steps[]`), not only a single bare `WriteLoopInput`. Existing bare-`WriteLoopInput` callers keep working unchanged.

## Decisions

- `start` accepts either the existing bare `WriteLoopInput` shape or a workflow-shaped input carrying an ordered `steps[]`; the daemon dispatches to `executeWriteLoop` or `executeWorkflow` accordingly.
- Runs/state-store/list-row behavior for a workflow-started run matches what `executeWorkflow` already persists per step (see `workflow-runner.md` snapshot/resume contract) — no new resume semantics invented here.
- Lands on the in-process daemon test harness; no new socket-gated tests, no new client-side field validators.

## Prerequisites

- `executeWorkflow` supports ordered multi-step execution with per-step attempt history and resume.
- Daemon `start` currently accepts only a bare `WriteLoopInput`.

## Out of scope

- The `implement` preset itself (separate intent).
- CLI/operator launch surface (separate intent).
- New pause/resume/abort semantics beyond what `executeWorkflow` already defines.
