---
name: pipeline-settlement-survives-daemon-restart
---

# A pipeline whose entry run terminates while the daemon is down wedges in derived `running` with no recovery verb

## Problem

When a workflow-stage entry run terminates while the daemon is not running, the stage stays `settlement_deferred`/`entry_run_still_live` and a daemon restart never reconciles it: the daemon reloads the pipeline in derived state `running` even though the referenced entry run's durable row is terminal. The pipeline is then unrecoverable — `jarvis pipeline resume` refuses `pipeline_not_resumable` (resume only re-enters `failed`/`awaiting-approval`), and the entry run cannot be killed (`run_not_active`, already terminal). Terminal publication never fires: the completed implement work sits committed on the local branch, never pushed, no PR, and the pipeline paints `running` forever.

Observed 2026-08-16: pipeline `aede4177` (`full-review`, seed `v2-init-command`) — intent and plan approved and merged (plan PR #2857); implement entry run `b35b61dd` settled `done` at 21:41:52, committing the subspec-00 implement work. The daemon then stopped. On restart the implement stage still reported `status: running`, `failureDetail: {code: settlement_deferred, reason: entry_run_still_live, entryRunId: b35b61dd, rollupStatus: in-progress}` while `b35b61dd` was durably `completed`/`not-live` with no live process. `jarvis pipeline resume aede4177` returned `pipeline_not_resumable`. No operator verb advances or clears it. Same daemon-death-orphans-durable-state theme as [[operator-terminates-stale-nonactive-runs]] (that seed covers bare runs; this covers pipeline settlement).

## Decisions

- On daemon start, reconcile every stage stuck awaiting an entry-run terminal (`settlement_deferred`/`entry_run_still_live`) whose referenced entry run is durably terminal: re-drive settlement from the run's recorded outcome — dispatch the pending successor/publication for a `done` entry run, fail the stage for a failed one — instead of leaving the pipeline derived `running`. Extend the existing orphaned-run reconciliation sweep (`reconcileOrphanedRuns`) to pipeline settlement, not only bare runs.
- A pipeline's settlement must be derivable from the durable entry-run row alone: a settlement pending at daemon death completes on restart without needing the live terminal boundary that was never delivered. Rules out requiring the in-memory `entry_run_still_live` flag to be cleared by a live event.
- A pipeline already wedged in this state must also be recoverable by an explicit verb: `jarvis pipeline resume` treats a `settlement_deferred` stage with a terminal entry run as resumable and drives settlement, rather than returning `pipeline_not_resumable`. Rules out the current dead end for a stuck-but-complete pipeline.

## Acceptance criteria

- [ ] A stage left `settlement_deferred`/`entry_run_still_live` with a durably-terminal `done` entry run is reconciled on daemon start — the pending publication dispatches and the pipeline advances toward terminal settlement — pinned by a daemon-restart reconciliation test.
- [ ] A stage with a durably-terminal failed entry run reconciles to a failed stage, not perpetual `running`, pinned by a test.
- [ ] `jarvis pipeline resume` on such a wedged pipeline drives settlement instead of returning `pipeline_not_resumable`, pinned by a test.
- [ ] A pipeline whose entry run is genuinely still live is left untouched by reconciliation, pinned by a test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — startup reconciliation of pipeline settlement orphaned by daemon death, and the durable-entry-run-derivable settlement guarantee.
- `v2/docs/operator-runbook.md` — how a daemon restart recovers a mid-settlement pipeline, and `pipeline resume` behavior for a `settlement_deferred` stage with a terminal entry run.
