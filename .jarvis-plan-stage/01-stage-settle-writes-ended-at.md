# Stage settle paths write `endedAt`

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

The stage-settle paths in `v2/src/daemon/pipeline-stage-dispatch.ts` and `v2/src/daemon/pipeline-execution.ts` are enumerated nowhere, so nothing pins that each terminal write carries `endedAt`. Two of them do not: `skipRemainingStages` (`pipeline-execution.ts:1003`) and the post-split default-placeholder elision in `admitFanOutBranches` (`pipeline-execution.ts:843`) both issue `patch: { status: "skipped" }`. The store's own derivation covers those rows durably, but the callers' issued patches are the layer every fake-store consumer and every future settle path sees, and neither the passing paths nor the failing ones are asserted anywhere. `settleUnexpectedThrow`'s failed-before-start shape (terminal, `endedAt` set, `startedAt` never written) is likewise unpinned.

## Decision ledger

- The guarantee is pinned by a source-level enumeration over both files rather than one behavioral test per path — rules out spot-checking the known-good paths, and pins a settle path added later without a test of its own. `write-loop-binding-source-guard.test.ts` and `paths.test.ts` are the existing precedent for source-scanned invariants in this suite.
- The enumeration asserts both that no terminal write lacks `endedAt` and that the discovered site list equals an expected literal — rules out an offenders-only assertion, which passes vacuously if the scan stops matching.
- Sites are identified as `file:enclosingFunction:status`, not line numbers — rules out an enumeration that churns on every edit above a settle path.
- `skipRemainingStages` hoists one `const endedAt = Date.now();` for the whole sweep, so every row skipped by one settlement shares a finish — rules out a per-row clock, which spreads one settle event across timestamps.
- `startedAt` is never synthesized on any settle path; a stage that failed before start stays terminal with `startedAt` null — rules out inventing a start so downstream elapsed renders.
- The dispatch-side paths are unchanged; this subspec adds `endedAt` at the two `skipped` writes only.

## Prerequisites

- Terminal-status stage writes in these two files are `settleUnexpectedThrow`, `applyEntryRunSettlement` (three writes), the dispatch-refusal write in `dispatchPipelineStage`, `settleApprovalBoundaryFailure`, `failWorkflowStageAt`, `advanceWorkflowStage`'s post-throw settle, `failStrandedPipelineStage`, `skipRemainingStages`, and `admitFanOutBranches`' placeholder elision.
- Both files declare every one of those functions at column 0 (`function name(` / `export async function name(`), so the nearest preceding declaration names the enclosing path.
- `store.updateStage` derives `ended_at` for terminal patches (`stageLifecyclePatchWithTerminalFinish`), so a caller-supplied `endedAt` is preserved and this change alters no durable row.

## Tasks

- `v2/src/daemon/pipeline-execution.ts`:
  - `skipRemainingStages`: hoist `const endedAt = Date.now();` above the loop and write `store.updateStage({ pipelineId, stageId: record.stageId, branchKey, patch: { status: "skipped", endedAt } });` — the keystone anchor, one physical line, unique in the file.
  - `admitFanOutBranches`' placeholder elision: `patch: { status: "skipped", endedAt: Date.now() },` — the placeholder guard anchor, one physical line, unique in the file.
- Tests — `v2/src/daemon/pipeline-stage-dispatch.test.ts`:
  - Helper `terminalStageSettleWrites(relPath)`: read the file under a `REPO_ROOT` resolved from `import.meta.dir`, walk every `patch: {` occurrence, take the brace-balanced object literal, keep those matching `status: "(succeeded|failed|interrupted|skipped)"`, and return `{ site, hasEndedAt }` where `site` is `` `${basename}:${enclosingFunction}:${status}` `` (enclosing function = nearest preceding line matching `/^(?:export )?(?:async )?function (\w+)/`) and `hasEndedAt` is whether the literal mentions `endedAt`.
  - `every terminal stage settle write carries endedAt`: over both files, assert the sites lacking `endedAt` are `[]` and the sorted site list equals the expected enumeration — `pipeline-execution.ts`: `admitFanOutBranches:skipped`, `advanceWorkflowStage:failed`, `failStrandedPipelineStage:failed`, `failWorkflowStageAt:failed`, `settleApprovalBoundaryFailure:failed`, `skipRemainingStages:skipped`; `pipeline-stage-dispatch.ts`: `applyEntryRunSettlement:failed` (twice), `applyEntryRunSettlement:succeeded`, `dispatchPipelineStage:failed`, `settleUnexpectedThrow:failed`. Carries the keystone `// @mutate`.
  - `the fan-out default placeholder is skipped with a finish timestamp`: assert the `admitFanOutBranches:skipped` site is present with `hasEndedAt` true. Carries the placeholder guard `// @mutate`.
  - `settleUnexpectedThrow settles the stage failed with endedAt and no startedAt`: drive `dispatchPipelineStage` with a `dispatch` that throws before admission and assert the single recorded patch is `status: "failed"` with a numeric `endedAt`, no `startedAt` key, and no preceding `running` linkage patch.
- Docs per Documentation updates.
- Run `bun run typecheck`, `bun run check`, `bun run test:v2`, `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `v2/src/daemon/pipeline-stage-dispatch.test.ts` — `every terminal stage settle write carries endedAt` enumerates every terminal-status stage write in `pipeline-stage-dispatch.ts` and `pipeline-execution.ts`, asserts each carries `endedAt`, and asserts the discovered site list matches the expected enumeration exactly; it fails against the pre-fix code, where `skipRemainingStages` and the `admitFanOutBranches` placeholder elision write `patch: { status: "skipped" }`.
- [ ] `v2/src/daemon/pipeline-stage-dispatch.test.ts` — `the fan-out default placeholder is skipped with a finish timestamp` asserts the placeholder-elision write carries `endedAt`, so the fan-out path is covered independently of the skip sweep.
- [ ] `v2/src/daemon/pipeline-stage-dispatch.test.ts` — `settleUnexpectedThrow settles the stage failed with endedAt and no startedAt` pins the failed-before-start shape for a throw before entry-run admission: terminal status, numeric `endedAt`, no `startedAt` written, and no `running` linkage patch.
- [ ] `v2/src/daemon/pipeline-stage-dispatch.test.ts` — `every terminal stage settle write carries endedAt`; Keystone checkpoint: its pinning test carries `// @mutate v2/src/daemon/pipeline-execution.ts "patch: { status: \"skipped\", endedAt } });" -> "patch: { status: \"skipped\" } });"` inside the test body — baseline semantics where a skip sweep issues a finishless terminal patch — and the mutation turns that regression RED.
- [ ] `v2/src/daemon/pipeline-stage-dispatch.test.ts` — `the fan-out default placeholder is skipped with a finish timestamp`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/daemon/pipeline-execution.ts "patch: { status: \"skipped\", endedAt: Date.now() }," -> "patch: { status: \"skipped\" },"` inside the test body — a superseded placeholder row elided with no finish — and the mutation turns that regression RED.
- [ ] Existing `v2/src/daemon/pipeline-execution.test.ts` skip-sweep and fan-out tests stay green (the added `endedAt` changes no status, ordering, or durable row).
- [ ] `v2/docs/daemon-host.md` § Pipeline stage dispatch and `v2/docs/v1-behaviors.md` record that every settle path writes `endedAt` and that a stage failing before start stays terminal with `startedAt` null.
- [ ] `bun run typecheck`, `bun run check`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § Pipeline stage dispatch — every stage-settle path in `pipeline-stage-dispatch.ts` and `pipeline-execution.ts` writes `endedAt` alongside the terminal status, including the `skipped` sweep after a failure and the superseded post-split placeholder row; one skip sweep stamps a single finish across the rows it settles. A throw before entry-run admission settles the row `failed` with `endedAt` and never writes `startedAt`, so a stage that failed before start is terminal with `started_at` null.
- `v2/docs/v1-behaviors.md` — record that terminal stage writes on the dispatch and execution settle paths now carry `endedAt` at the call site (previously the two `skipped` writes issued a finishless patch and relied on the store's derivation), and that the failed-before-start shape leaves `started_at` null.
