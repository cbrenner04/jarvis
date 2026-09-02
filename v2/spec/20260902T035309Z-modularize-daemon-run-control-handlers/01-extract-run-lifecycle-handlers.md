# Extract run-lifecycle handlers

## Problem

Run lifecycle RPC handlers (`start`, `list`, `pause`, `resume`, `kill`, `wait`, `dismiss`, `undismiss`) and their promotion/spawn helpers live inside the `createRunControlHandlers` closure in `daemon.ts` (~lines 1069–2080), blocking co-located direct tests and keeping the factory non-wiring.

## Decision ledger

- New module `v2/src/daemon/daemon-run-lifecycle-handlers.ts` owns run lifecycle handlers and their private helpers (`promoteQueuedRun` binding, `spawnWriteLoop`, wait fanout, dismissal handlers, `resumeFinalizationOnly`); rules out leaving these handlers inline in `daemon.ts`.
- Subspec 01 moves lifecycle RPC bodies only; workflow closure helpers (`handleWorkflowStart`, claim paths inside `start`) stay in `daemon.ts` until subspec 02; rules out extracting `start`'s workflow orchestration before the workflow-admission module exists.
- Lifecycle module owns default `pipelineDispatch` and `pipelineWait` construction (closing over `handleWorkflowStart` and `waitForWorkflowEntryRun`); rules out pipeline module constructing those defaults.
- Handler factories take `RunControlHandlerContext` plus the deps slice they need; rules out re-capturing closure locals from `createRunControlHandlers`.
- RPC method names, params, and error codes stay identical; rules out behavior changes riding the extraction.
- `createRunControlHandlers` wires lifecycle handlers from the new module only; rules out duplicate handler definitions in `daemon.ts`.

## Task checklist

- [ ] Move run lifecycle handler implementations and their private helpers into `daemon-run-lifecycle-handlers.ts`; leave workflow closure helpers (`handleWorkflowStart`, claim paths inside `start`) in `daemon.ts` for subspec 02.
- [ ] Export factory functions that accept `RunControlHandlerContext` and return the lifecycle `RpcHandler` map entries.
- [ ] Slim `createRunControlHandlers` to delegate lifecycle wiring to the new module.
- [ ] Add `daemon-run-lifecycle-handlers.test.ts` with direct in-process handler tests (no socket) covering at least `start` admission, `list` projection, and `pause`/`kill` ownership release.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-run-lifecycle-handlers.test.ts` exercises lifecycle handlers through the extracted module with injected fakes; it fails against the pre-fix tree where handlers live only inside `daemon.ts`.
- [ ] `v2/src/daemon/daemon-start-list.test.ts` stays green (behavior unchanged by the extraction).
- [ ] `v2/src/daemon/daemon-resume.test.ts` stays green (behavior unchanged by the extraction).
- [ ] `v2/src/daemon/daemon-wait-run-completion.test.ts` stays green (behavior unchanged by the extraction).
- [ ] `bun run typecheck` passes.

## Documentation updates

None — handler module map is updated in subspec 06 after all extractions land.
