---
name: operator-killed-pipeline-stage-is-recoverable
---

# An operator-killed pipeline stage settles `interrupted`, which no verb can resume (resume refuses, restart continuation skips)

## Problem

Force-killing a wedged pipeline-linked run funnels the pipeline into a dead end no supported verb recovers:

1. A stage's run wedges — durable `in-progress` but `not-live`, one `iteration_started` event, no agent invocation, no idle-output watchdog (write loop apparently threw before agent invoke; see the pending `write-loop-iteration-timeout-on-stall` root cause).
2. `jarvis daemon stop` refuses while that run is durable-active (`DaemonStopRefusedError: active durable runs`), so the only unblock is `jarvis run kill --force <run-id>` — which settles the run `killed` and the stage row `interrupted`.
3. From there both exits are closed:
   - `jarvis pipeline resume` refuses — `resumeDeferredRefusalApplies` (`v2/src/daemon/pipeline-execution.ts:169`) returns true for derived `interrupted` unconditionally (`pipeline_not_resumable`).
   - Restart continuation skips it — `isPipelineContinuable` requires `derivePipelineState(pipeline) === "pending"`, but any stage row with status `interrupted` makes the derived state `interrupted` (`pipeline-execution.ts:2186`). `daemon-host.md` § Restart-safe pipeline continuation says reconciled-`interrupted` pipelines "become activatable again", but that holds only for pipeline-level status — a stage-level `interrupted` row poisons the derived state permanently.

So *wedged run → forced kill (the only way to free `daemon stop`) → interrupted stage → no recovery verb* is a guaranteed dead end — the kill-shaped sibling of the fan-out "no landing path" (#2984) and the settlement-orphan wedge ([[pipeline-settlement-survives-daemon-restart]]).

Observed 2026-08-25, `cbrenner04/chess-mvp-yolo` pipeline `5072c5e7` (`fast`): intent `succeeded` / plan `interrupted` / implement `pending`; wedged plan run `3e69bf90` (`plan/game-model-and-rules`) force-killed after `daemon stop` refused. `pipeline resume 5072c5e7` → `pipeline_not_resumable`; a subsequent daemon restart (rev `4c85ac40`) did not continue it. Operator exit: dismiss the pipeline, salvage the intent's ready-intent to `main` by hand, retire worktrees/branches, continue with standalone presets. Issue #2996.

## Decisions

- An operator-killed (`interrupted`) stage row must be recoverable. Pick one (or both): (a) `pipeline resume` treats an `interrupted` stage like `failed` — reopen and redispatch through the ordinary write step; (b) `run kill` on a pipeline-linked run settles the stage row `failed` rather than `interrupted`, so the existing reopen path applies. Rules out leaving `interrupted` as a terminal dead end.
- Restart continuation must not be poisoned by a single `interrupted` stage row: an operator-killed stage should be reset/reconciled on daemon start the way orphaned runs are, so the pipeline becomes continuable again. Rules out one `interrupted` row permanently blocking `isPipelineContinuable`.
- `pipeline_not_resumable` must say *why* and what to do — derived state, offending stage, suggested verb — rather than a bare reason code. Rules out sending the operator down the wrong path (the runbook implied interrupted pipelines auto-recover).
- Do not resurrect a pipeline the operator deliberately abandoned via `pipeline dismiss` — recovery applies to resume/restart intent, not to dismissed rows. Rules out un-dismissing.

## Acceptance criteria

- [ ] After `jarvis run kill --force` settles a pipeline-linked run and its stage `interrupted`, a recovery path exists: `jarvis pipeline resume` reopens and redispatches that stage (or `run kill` settled it `failed` so resume already applies) — pinned by a daemon/pipeline test seeding a killed→interrupted stage and asserting resume drives it forward instead of `pipeline_not_resumable` (fails today).
- [ ] Daemon-restart continuation resets/reconciles an operator-killed `interrupted` stage row so the pipeline is continuable, rather than the `interrupted` row poisoning `derivePipelineState` — pinned by a restart-continuation test (fails today).
- [ ] `pipeline_not_resumable` (and analogous refusals) name the derived state and the offending stage — pinned by a test asserting the message content.
- [ ] A dismissed pipeline is not resurrected by the above — pinned by a test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — recovery for an operator-killed pipeline stage; correct the claim that interrupted pipelines auto-recover on restart (stage-level `interrupted` behavior).
- `v2/docs/daemon-host.md` — restart continuation reconciling operator-killed stage rows, and `pipeline resume` handling of `interrupted` stages.
