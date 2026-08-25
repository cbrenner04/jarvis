---
name: daemon-start-reconciles-deferred-pipeline-settlement
---

# Daemon start reconciles a stage whose settlement was deferred behind a now-terminal entry run

## Prerequisites

## Problem

A workflow stage settles through the live entry-run boundary. When the daemon dies between the entry run reaching a durable terminal status and that boundary being delivered, the stage stays `running` with `failureDetail: { code: settlement_deferred, reason: entry_run_still_live }` forever: startup pipeline reconciliation settles orphaned *pipelines* and `recoverContinuablePipelines` only walks pipelines whose derived state is `pending`, so a pipeline derived `running` off that stale stage row is never revisited. Terminal publication never fires — observed 2026-08-16 on pipeline `aede4177`, whose implement entry run `b35b61dd` was durably `completed`/not-live while the stage still read `running`.

## Decisions

- Settlement is derivable from the durable entry-run row alone: a stage whose linked entry run is durably terminal settles from that row's recorded outcome, with no live boundary event. Rules out requiring the in-memory `entry_run_still_live` flag to be cleared by a live terminal event that a dead daemon can never deliver.
- Daemon startup sweeps every stage left `settlement_deferred`/`entry_run_still_live` and re-drives settlement: a `completed` entry run advances the stage (dispatching the pending successor/publication), a failed one fails the stage. Rules out leaving the pipeline derived `running` for an operator verb to notice.
- A stage whose linked entry run is still live is left untouched by the sweep. Rules out settling a stage out from under a running entry run after an unrelated daemon bounce.
- Extend the existing startup reconciliation seam rather than adding a separate pipeline-settlement sweep, so ordering against run/pipeline reconciliation and continuation stays single-sourced.

## Acceptance criteria

- [ ] A stage left `settlement_deferred`/`entry_run_still_live` whose entry run is durably `completed` is reconciled on daemon start — the stage advances and the pending successor/publication dispatches — pinned by a daemon-restart reconciliation test.
- [ ] The same stage shape with a durably failed entry run reconciles to a `failed` stage rather than perpetual `running`, pinned by a test.
- [ ] A stage whose linked entry run is genuinely still live is left unchanged by the sweep, pinned by a test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — startup reconciliation of deferred pipeline settlement, its ordering against run/pipeline reconciliation and continuation, and the durable-entry-run-derivable settlement guarantee.
- `v2/docs/operator-runbook.md` — a daemon restart now recovers a mid-settlement pipeline.
- `v2/docs/v1-behaviors.md` — the deferred-settlement re-settlement catalog entry, adding the daemon-startup sweep as a path alongside `continuePipeline`, adopt paths, and `pipeline_resume`.
