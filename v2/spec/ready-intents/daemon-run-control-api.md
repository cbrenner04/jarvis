---
name: daemon-run-control-api
---

# Daemon programmatic run-control API

Programmatic run-control over the unchanged core — exactly the Phase 3 build-order verbs, no more: start a run, list runs, tail log, pause/resume/kill. Daemon spawns `executeWriteLoop` with an `AbortSignal` it owns; wires cancellation without the core learning about the daemon.

Source: Phase 3 scope (3) in `v2/spec/seeds/phase-3-daemon-host.md`; Steering semantics, Runs/state, Recovery in `v2/docs/v2-architecture.md`. Done condition is merged code in `v2/src`, not this intent.

## What exists today

- `executeWriteLoop` is host-agnostic (inputs + `AbortSignal` only).
- State store owns orchestration rows; resume key is `(project, branch)`.
- Test bindings drive the loop (`v2/src/testing/bindings.ts`).

## Scope

- **Start a run** — daemon spawns `executeWriteLoop`, returns run ID.
- **List runs** — merge durable state rows with in-memory liveness.
- **Tail log** — stream structured log events for a run (over IPC streaming channel).
- **Pause / resume / kill** — steering vocabulary only:
  - **Pause** = graceful at next iteration boundary; in-flight agent step finishes; loop stops completed-at-boundary. Not abort mid-step.
  - **Kill** = immediate — abort `AbortSignal` now; SIGTERM→SIGKILL agent process group (v1 abort); dirty worktree OK.
  - **Resume** branches on how the step stopped: paused/boundary → continue; killed/crashed → re-run interrupted step over dirty worktree (existing resume path). Record which on the run.
- **Guard:** at most one active run per `(project, branch)`; different specs/worktrees on different branches OK.
- Daemon runs **one run at a time** beyond the per-(project,branch) guard — no queue, no admission control.
- Reuse state store as-is for orchestration; daemon never owns work (git worktree/branch).

## Out of scope

- CLI commands (sibling intent).
- TUI, workflow runner, PR lifecycle, human-loop approve/revise/abort.
- Concurrency, memory watermark, `queued` status (Phase 7).
- Richer steering (edit spec mid-run, inject messages, reorder steps) — Phase 6.
- Real agent bindings (test bindings suffice).

## Decisions

- API surface is start/list/tail/pause/resume/kill only — rules out inventing verbs no current caller exercises.
- Pause stops at iteration boundary without aborting the in-flight step — rules out mapping pause to immediate `AbortSignal`.
- Kill uses immediate abort + agent process-group teardown — rules out graceful kill or clean-tree guarantee.
- Resume reads how the step stopped (paused-at-boundary vs interrupted) from durable run state — rules out resume ignoring kill/crash dirty-worktree path.
- One active run per `(project, branch)` enforced at start — rules out overlapping runs on the same branch.
- Single in-flight run globally in this phase — rules out queue/admission/`queued` status (Phase 7).
- `executeWriteLoop` and state-store schema stay host-agnostic — rules out daemon-specific columns beyond what resume/steering already need.
- Deferred to first consumer: exact IPC method names and protobuf/JSON wire encoding — pin in refine with CLI as first caller.

## Documentation updates

- `v2/docs/v2-architecture.md` — reconcile Steering semantics and Interface run-control verbs with shipped behavior if refine settles details beyond current doc.

## Prerequisites

- Structured log events keyed by run ID with sink and tail/follow reader
- Long-running daemon with typed IPC transport and start/stop/status lifecycle
- Resumable write loop honoring `AbortSignal` cancellation and kill/crash resume over a dirty worktree
