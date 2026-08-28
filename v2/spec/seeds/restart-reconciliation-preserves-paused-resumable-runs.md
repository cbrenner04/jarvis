---
name: restart-reconciliation-preserves-paused-resumable-runs
---

# Daemon-restart reconciliation preserves a durably paused/resumable run instead of flipping it to killed

## Problem

A write run that settled **paused / `resumable: true`** is flipped to `killed` by daemon-restart reconciliation, and that reconciliation settles the pipeline `failed` — leaving the surfaces internally inconsistent: run status `killed`, but stage `failureDetail: {reason: "missing_blocker", retryable: true, nextAction: "resume"}`. A paused run is not a live invocation — there is no in-flight agent process for a restart to orphan — so reconciliation sweeping it to `killed` makes any daemon restart destructive to every lane waiting on operator action. Same dead-end-failure-state family as #2996.

## Evidence (2026-08-28, #3030)

Pipeline `af881ac0` on `cbrenner04/chess-mvp-yolo`, run `fb52cb87`, lane `board-display-settings`: 18:16:07 the run settled `missing_blocker` — `boundary_committed runStatus: "paused"`, `loop_finished resumable: true` (seq 13–15), durable and checkpointed. 18:50:13 daemon restart → `run_reconciled runStatus: "killed" reason: "daemon_restart"` (seq 16), and the pipeline settled `failed` at the same instant, 34 minutes after the terminal boundary was durable.

## Decisions

- Daemon-restart reconciliation must not flip a run whose durable terminal boundary is `paused`/`resumable` to `killed`: such a run has no live process to orphan. Its paused/resumable state (and the stage's `retryable`/`nextAction: resume`) is preserved across restart. Rules out restart being destructive to operator-actionable lanes.
- Reconciliation still flips a genuinely-orphaned in-flight run (no durable terminal boundary) to `killed` as today. Rules out leaving actually-dead live runs unreconciled.
- A pipeline whose only non-terminal lane is a preserved paused/resumable run is not settled `failed` by the restart; it stays resumable (`pipeline resume` reaches it). Rules out the restart alone settling the pipeline failed.

## Acceptance criteria

- [ ] A reconciliation test proves a run with a durable `paused`/`resumable: true` boundary survives daemon-restart reconciliation as paused/resumable (not `killed`), pinned; red against the current sweep.
- [ ] A test proves an in-flight run with no durable terminal boundary is still reconciled to `killed` on restart (no regression).
- [ ] A pipeline-level test proves a restart over a paused/resumable lane leaves the pipeline resumable rather than settling it `failed`, and `pipeline resume` reaches the lane.
- [ ] `bun run typecheck` and `bun run test:v2` + `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — restart preserves paused/resumable runs; recovery via `pipeline resume`; cross-link #2996.
- `v2/docs/v1-behaviors.md` — reconciliation no longer kills durably paused/resumable runs on restart.
