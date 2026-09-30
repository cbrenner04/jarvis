# Ready finalization writes ready-flip evidence after flip success

## Problem

Observed harness-flipped PRs (#4216, #4191, #4227) were flipped by implement completion's ready finalization (`createReadyFinalizer` in `ready-finalize.ts`, `ghReadyFlip(input.prNumber, …)` via `flipWithRetry` after a green gate), not terminal publication. That path records no ready-flip evidence, so republication's lineage lookup (`findNewestHarnessReadyFlipEvidenceInLineage`, scoped `(project, branch, spec_ref)`) cannot recognize those PRs.

## Decisions

- Add optional `recordHarnessReadyFlipEvidence?: (args: { prNumber: number; branch: string; baseRef: string }) => void` to `ReadyFinalizeInput`; invoke it once, only after `flipWithRetry` resolves (including the `already ready` / `not a draft` success guard), with `{ prNumber: input.prNumber, branch: input.branch, baseRef: input.baseRef }` — rules out writes on gate/mutation/smoke/flip failure and per-retry writes.
- Skip the write when `input.prNumber` is undefined or the callback is absent — rules out evidence without a PR number.
- Bind the callback in `write-loop.ts` `publishWithReadyRepair` beside `storeVerifierProcessGroupRecorder(store, result.runId)`, threaded through `runReadyFinalizer` to `store.recordHarnessReadyFlipEvidence({ runId: result.runId, … })` — `result.runId` is the write-loop run row whose `branch` / `spec_ref` the lineage lookup scans; implementer confirms that row's `branch` equals `input.branch` and its `spec_ref` is the spec the downstream republication queries, else binds the row that does.
- Keep `ready-finalize.ts` free of `StateStore` imports — callback only.

## Tasks

- [ ] Extend `ReadyFinalizeInput` and invoke the callback after successful `flipWithRetry`.
- [ ] Thread the callback from `publishWithReadyRepair` through `runReadyFinalizer`, bound to `result.runId` and `store.recordHarnessReadyFlipEvidence`.
- [ ] Add `ready-finalize.test.ts` coverage with fake `ghReadyFlip` and in-memory `StateStore`.
- [ ] Add `write-loop` coverage that the bound callback targets `result.runId`.
- [ ] Update docs per Documentation updates.

## Acceptance criteria

- [x] `ready-finalize.test.ts` fails against the pre-fix path and pins evidence on the run row after a successful flip.
- [x] `ready-finalize.test.ts` pins no write when fake `ghReadyFlip` rejects non-transiently (prior row evidence unchanged) and when the gate fails before the flip.
- [x] `ready-finalize.test.ts` pins exactly one write when fake `ghReadyFlip` fails transiently then succeeds.
- [x] Write-loop test pins the callback bound to `result.runId`, and the written row is found by `findNewestHarnessReadyFlipEvidenceInLineage` for the same project/branch/spec_ref/baseRef/PR.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- [x] `v2/docs/write-behavior.md` — Ready finalization paragraph: a successful flip records ready-flip evidence on the write-loop run row; failures record none.
- [x] `v2/docs/v1-behaviors.md` — ready finalization records harness ready-flip evidence after a successful flip.
- [x] `v2/docs/state-store.md` — list ready finalization as a production writer of `recordHarnessReadyFlipEvidence`.
