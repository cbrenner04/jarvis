# Extract pipeline handlers

## Problem

All `pipeline_*` RPC handlers and `continueContinuablePipelines` / `pipelineExecutionDeps` wiring live inside the `createRunControlHandlers` closure (~lines 2134–2411), leaving `daemon.ts` as the only place pipeline run-control behavior can be tested in isolation.

## Decision ledger

- New module `v2/src/daemon/daemon-pipeline-handlers.ts` owns every `pipeline_*` handler plus `continueContinuablePipelines` and `pipelineExecutionDeps` assembly; rules out splitting pipeline RPCs across unrelated modules or leaving them inline.
- Pipeline module assembles `pipelineExecutionDeps` with injected `pipelineDispatch` and `pipelineWait` only; rules out pipeline module owning default dispatch/wait construction (owned by lifecycle module per subspec 01).
- Pipeline handler factories take `RunControlHandlerContext` and the existing injectable pipeline seams (`resolveStage`, `pipelineDispatch`, `pipelineWait`, `recoveryAttempt`, `recoveryLogSinkFactory`, `executeTerminalPublication`, stale-reset client deps); rules out dropping test seams during extraction.
- `createRunControlHandlers` becomes wiring-only after this slice: no remaining inline `RpcHandler` bodies for run control; rules out keeping any handler implementation in `daemon.ts` beyond delegation.
- Lifecycle/control seams (`close`, `hasActiveRuns`, `setRetiring`, `isRetiring`, review-progress reporters) assemble in `daemon.ts` from context; pipeline module returns pipeline RPC entries plus pipeline-only seams (`continueContinuablePipelines`, `pipelineExecutionDeps`); rules out moving lifecycle/control seams into the pipeline module.
- RPC contracts and non-RPC seams (`reportReviewDebateProgress`, `clearLiveReviewDebateProgress`, `close`, `hasActiveRuns`, `setRetiring`, `isRetiring`, `context`) stay on the returned handler object with unchanged behavior; rules out export-shape changes beyond the `context` seam from subspec 00.

## Task checklist

- [ ] Move all `pipeline_*` handlers, `continueContinuablePipelines`, and `pipelineExecutionDeps` into `daemon-pipeline-handlers.ts`.
- [ ] Export a factory that accepts `RunControlHandlerContext` plus pipeline deps and returns the pipeline handler map entries and seams.
- [ ] Reduce `createRunControlHandlers` in `daemon.ts` to context construction plus module wiring only.
- [ ] Add `daemon-pipeline-handlers.test.ts` with direct tests for at least `pipeline_start` admission refusal, `pipeline_list` projection, and `pipeline_recover` resolution refusal.

## Acceptance criteria

- [x] `v2/src/daemon/daemon-pipeline-handlers.test.ts` exercises pipeline handlers through the extracted module; it fails against the pre-fix tree where pipeline handlers live only inside `daemon.ts`.
- [x] `v2/src/daemon/daemon-pipeline-recover.test.ts` stays green (behavior unchanged by the extraction).
- [x] `v2/src/daemon/daemon-pipeline-start.test.ts` stays green (behavior unchanged by the extraction).
- [x] `v2/src/daemon/daemon.ts` defines no inline run-control `RpcHandler` bodies after wiring (reachable on merge-base inside `createRunControlHandlers`, ~lines 1504–2410); only imports, context construction, and handler-map assembly remain.
- [x] `bun run typecheck` passes.

## Documentation updates

None — handler module map is updated in subspec 06.
