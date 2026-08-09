# Every stage settle path writes a finish time

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

Nothing enumerates the stage-settle writes in `v2/src/daemon/pipeline-stage-dispatch.ts` and `v2/src/daemon/pipeline-execution.ts`, so no test pins that a write landing a terminal stage status also lands `endedAt`. Two of them do not: `skipRemainingStages` (`pipeline-execution.ts:1003`) and the fan-out placeholder skip in `admitFanOutBranches` (`pipeline-execution.ts:843`) both issue `patch: { status: "skipped" }`. Both currently land a finish time only because `StateStore.updateStage` derives one via `stageLifecyclePatchWithTerminalFinish`; every caller that writes stage rows without that derivation — the fake stores in `pipeline-execution.test.ts` and `pipeline-stage-dispatch.test.ts` — sees a terminal row with `endedAt: null`. `settleUnexpectedThrow`'s failed-before-start shape (terminal, `endedAt` set, no `startedAt`) is likewise unpinned.

## Decision ledger

- Each settle site writes `endedAt` itself; the store's derivation stays as a backstop rather than the guarantee — rules out pinning the derived row instead, which passes on the pre-fix code and leaves the call sites unconstrained.
- The enumeration lives in each module's own test file (`pipeline-stage-dispatch.test.ts` for the dispatch-module paths, `pipeline-execution.test.ts` for the execution-module paths) — rules out one cross-module test that would have to export five private execution helpers into the dispatch test file.
- `settleUnexpectedThrow` keeps writing no `startedAt`: a stage that failed before entry-run admission never started — rules out synthesizing a start so elapsed renders.
- `settleUnexpectedThrow`'s `updateStage` call collapses to one physical line with the message hoisted to a `const`, purely so the failed-before-start patch has a unique single-line mutation anchor.
- The skip writes hoist `endedAt` to a `const` per call rather than inlining `Date.now()` where that would push the line past the 120-column formatter width and re-wrap the anchor.

## Prerequisites

- `dispatchPipelineStage` and `adoptAndSettlePipelineStage` are exported from `v2/src/daemon/pipeline-stage-dispatch.ts`; `pipeline-stage-dispatch.test.ts`'s `fakeStore` records raw `updateStage` patches without the store's terminal derivation.
- `pipeline-execution.test.ts`'s `fakeStore` applies patches onto in-memory stage records with `Object.assign` and no terminal derivation, so a skip write with no `endedAt` leaves `endedAt: null`.
- `isTerminalStageStatus` is exported from `v2/src/persistence/state-store.ts`.

## Tasks

- `v2/src/daemon/pipeline-execution.ts`:
  - `skipRemainingStages` hoists `const endedAt = Date.now();` above its loop and writes `patch: { status: "skipped", endedAt }` (one physical line, mutation anchor).
  - `admitFanOutBranches`' post-split default placeholder write becomes `patch: { status: "skipped", endedAt: Date.now() },` (one physical line, mutation anchor).
- `v2/src/daemon/pipeline-stage-dispatch.ts` — `settleUnexpectedThrow` hoists `const message = error instanceof Error ? error.message : String(error);` above the `try` and its body becomes the single line `store.updateStage({ ...target, patch: { status: "failed", endedAt: Date.now(), failureDetail: { message } } });`. Behavior is unchanged.
- Tests — `v2/src/daemon/pipeline-stage-dispatch.test.ts`:
  - `every dispatch-module settle path writes endedAt with its terminal status`: drives each dispatch-module settle path against a fresh recording `fakeStore` — dispatch refusal, entry-run success, success with no recorded `specPath`, non-completed settlement with a dead entry run, and unexpected throw — then asserts every recorded patch whose `status` satisfies `isTerminalStageStatus` carries a numeric `endedAt`, that every non-terminal patch (running linkage, deferred settlement) carries none, and that the exercised path names equal the five enumerated above.
  - `a throw before entry-run admission settles failed with an end time and no start time`: a dispatch whose callback throws before admission records exactly one patch — `status: "failed"`, numeric `endedAt`, and no `startedAt` key. Carries the no-start-synthesis `// @mutate`.
- Tests — `v2/src/daemon/pipeline-execution.test.ts`:
  - `every execution-module settle path writes endedAt with its terminal status`: drives `failWorkflowStageAt` (stage-resolution failure), `settleApprovalBoundaryFailure` (approval boundary refused with an unexpected status, as in `a refused boundary write with an unexpected status settles failed without skipping the suffix`), `skipRemainingStages` (a failed stage with undispatched successors, as in `a stage that settles failed settles the pipeline failed and skips every later stage undispatched`), the stage-step throw handler, and `failStrandedPipelineStage`; asserts every resulting stage record whose status satisfies `isTerminalStageStatus` carries a numeric `endedAt`, and that the exercised path names equal the five enumerated above. Drive each through the module's exported entry points; export a settle helper only for a path unreachable that way. Carries the keystone `// @mutate`.
  - `fan-out placeholder skip writes endedAt with its skipped status`: after fan-out admission (model on `after fan-out admission, default rows do not dispatch plan or implement while per-branch rows exist`), the superseded post-split `default` record carries `status: "skipped"` with a numeric `endedAt`. Carries the placeholder-skip `// @mutate`.
- Docs per Documentation updates.
- Run `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `v2/src/daemon/pipeline-execution.test.ts` — `every execution-module settle path writes endedAt with its terminal status` enumerates the execution-module settle paths and asserts each terminal stage record carries a numeric `endedAt`; it fails against the pre-fix code, where `skipRemainingStages` issues `patch: { status: "skipped" }` and leaves `endedAt` null.
- [ ] `v2/src/daemon/pipeline-execution.test.ts` — `fan-out placeholder skip writes endedAt with its skipped status` asserts the superseded post-split `default` record carries a numeric `endedAt`; it fails against the pre-fix code.
- [ ] `v2/src/daemon/pipeline-stage-dispatch.test.ts` — `every dispatch-module settle path writes endedAt with its terminal status` asserts every terminal-status patch from the five dispatch-module settle paths carries a numeric `endedAt` and that non-terminal patches carry none.
- [ ] `v2/src/daemon/pipeline-stage-dispatch.test.ts` — `a throw before entry-run admission settles failed with an end time and no start time` pins the failed-before-start shape: terminal status, numeric `endedAt`, no `startedAt` key on the patch.
- [ ] `v2/src/daemon/pipeline-execution.test.ts` — `every execution-module settle path writes endedAt with its terminal status`; Keystone checkpoint: its pinning test carries `// @mutate v2/src/daemon/pipeline-execution.ts "patch: { status: \"skipped\", endedAt }" -> "patch: { status: \"skipped\" }"` inside the test body — baseline semantics where a skip write lands no finish time of its own — and the mutation turns that regression RED.
- [ ] `v2/src/daemon/pipeline-execution.test.ts` — `fan-out placeholder skip writes endedAt with its skipped status`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/daemon/pipeline-execution.ts "patch: { status: \"skipped\", endedAt: Date.now() }," -> "patch: { status: \"skipped\" },"` inside the test body — the placeholder skip landing no finish time — and the mutation turns that regression RED.
- [ ] `v2/src/daemon/pipeline-stage-dispatch.test.ts` — `a throw before entry-run admission settles failed with an end time and no start time`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/daemon/pipeline-stage-dispatch.ts "patch: { status: \"failed\", endedAt: Date.now(), failureDetail: { message } }" -> "patch: { status: \"failed\", endedAt: Date.now(), startedAt: Date.now(), failureDetail: { message } }"` inside the test body — a failed-before-start settle synthesizing a start time — and the mutation turns that regression RED.
- [ ] `v2/src/daemon/pipeline-stage-dispatch.test.ts` and `v2/src/daemon/pipeline-execution.test.ts` stay green apart from the added tests (the settle writes' statuses, failure details, and artifacts are unchanged by this subspec).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § Pipeline stage dispatch — every settle write that lands a terminal stage status (`succeeded`, `failed`, `interrupted`, `skipped`) writes `endedAt` at the call site, including the suffix-skip and fan-out placeholder-skip writes; the store's terminal derivation is a backstop, not the source. Record the failed-before-start shape: a throw before entry-run admission settles `failed` with `endedAt` and no `startedAt`.
- `v2/docs/v1-behaviors.md` — record that suffix-skip and fan-out placeholder-skip stage writes now carry `endedAt` from the call site (previously derived only by `StateStore.updateStage`), and that a stage failing before entry-run admission keeps `startedAt` null.
