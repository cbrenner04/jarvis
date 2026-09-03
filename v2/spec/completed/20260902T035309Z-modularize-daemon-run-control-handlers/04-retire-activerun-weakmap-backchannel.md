# Retire activeRun WeakMap back-channel

## Problem

`activeRunsByHandler` and `activeRunForHandler` (`daemon.ts:170–175`) let tests recover live `activeRuns` from the handler return object, hiding the explicit context seam introduced in subspec 00 and coupling tests to handler identity instead of shared state.

## Decision ledger

- Delete `activeRunsByHandler` and `activeRunForHandler` from `v2/src/daemon/`; rules out retaining a compatibility re-export or test-only WeakMap.
- `daemon-workflow-start.test.ts` and `daemon-pipeline-recover.test.ts` read live runs through `handlers.context.activeRuns` from the shared `createRunControlHandlers` return seam (subspec 00); rules out replacing the WeakMap with another handler-keyed side channel or a separate `createRunControlHandlerContext` call.
- Static guard `daemon-run-control-handler-guard.test.ts` scans production daemon sources for the forbidden symbols; rules out ad-hoc grep in unrelated tests as the only regression pin.
- RPC behavior stays unchanged; rules out admission or wait semantics changes while retargeting tests.

## Task checklist

- [ ] Remove `activeRunsByHandler`, `activeRunForHandler`, and the `activeRunsByHandler.set` call at handler construction.
- [ ] Retarget `daemon-workflow-start.test.ts` and `daemon-pipeline-recover.test.ts` to assert through `handlers.context.activeRuns` from `createRunControlHandlers`.
- [ ] Add `daemon-run-control-handler-guard.test.ts` that fails when either forbidden symbol appears anywhere under `v2/src/daemon/` production sources.

## Acceptance criteria

- [x] `v2/src/daemon/daemon-run-control-handler-guard.test.ts` reports violations when `activeRunsByHandler` or `activeRunForHandler` is present under `v2/src/daemon/`; it fails against the pre-fix tree where both symbols are reachable at `daemon.ts:170–175`.
- [x] `v2/src/daemon/daemon-workflow-start.test.ts` stays green after repointing off `activeRunForHandler`.
- [x] `v2/src/daemon/daemon-pipeline-recover.test.ts` stays green after repointing off `activeRunForHandler`.
- [x] `bun run typecheck` passes.

## Documentation updates

None — test construction guidance lands in subspec 07.
