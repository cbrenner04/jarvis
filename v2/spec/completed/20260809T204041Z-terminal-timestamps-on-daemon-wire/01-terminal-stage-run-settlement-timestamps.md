# Terminal stage-run settlement timestamps

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

The state store backfills `endedAt` on a terminal stage patch, but daemon writers do not all state that contract: the two `skipped` writes in `pipeline-execution.ts` omit it. Existing tests spot-check routes rather than detecting a newly unclassified terminal stage-run write.

## Decision ledger

- Every daemon settlement patch carrying a terminal stage-run status (`succeeded`, `failed`, `interrupted`, or `skipped`) carries numeric `endedAt`, even though `StateStore.updateStage` remains a persistence backstop. `approved` and `rejected` are approval decisions, not terminal stage-run statuses, and are excluded from this invariant. Rules out relying on store-side derivation, which leaves mocked writers and future alternate stores unable to observe the settlement contract.
- A source-backed inventory parses every `store.updateStage` call in `pipeline-stage-dispatch.ts` and `pipeline-execution.ts`. Every patch that supplies `status` must use a literal status; the discovered status-bearing callsites must exactly match the classified route map, and each classified terminal stage-run callsite must carry `endedAt`. A newly added, renamed, dynamically hidden, or reclassified terminal write therefore fails until it is classified; formatting does not affect the check. Rules out a hand-maintained spot-check list.
- The terminal dispatcher result path is the `if (!dispatched.ok)` failed write; admission-claim refusal is non-terminal and outside this inventory. Rules out presenting refusal as a settlement write.
- No TUI rendering or elapsed aggregation change. Rules out absorbing later observation-consumer work into this settlement slice.

## Prerequisites

- `StateStore.updateStage` stamps `endedAt` on every terminal stage-run status and never synthesizes `startedAt`.

## Tasks

- Audit terminal stage-run `updateStage` patches in `v2/src/daemon/pipeline-stage-dispatch.ts`: the `if (!dispatched.ok)` terminal dispatcher result path and each terminal branch of `applyEntryRunSettlement`; retain explicit `endedAt` on each. The failed-before-start producer is covered by the following subspec.
- Audit terminal stage-run `updateStage` patches in `v2/src/daemon/pipeline-execution.ts`: fan-out default-row skip in `admitFanOutBranches`, `settleApprovalBoundaryFailure`, `skipRemainingStages`, `failWorkflowStageAt`, the `advanceWorkflowStage` catch, and `failStrandedPipelineStage`; add explicit `endedAt` to both skipped writes, retain it on failures, and keep the `skipRemainingStages` write on the exact single line named by the mutation directive.
- Add `pipeline-stage-dispatch.test.ts` source-inventory coverage that parses both modules, rejects a nonliteral supplied status, verifies the complete status-bearing callsite manifest, classifies every terminal stage-run write, and rejects a classified terminal patch without `endedAt`.
- Apply the Documentation updates.
- Run `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [x] `v2/src/daemon/pipeline-stage-dispatch.test.ts` — `every terminal pipeline stage-run write carries endedAt` parses every `store.updateStage` call in `pipeline-stage-dispatch.ts` and `pipeline-execution.ts`, rejects a nonliteral supplied status, asserts discovered status-bearing identities exactly equal the classified route map, and asserts numeric `endedAt` on every `succeeded`, `failed`, `interrupted`, or `skipped` patch; `approved` and `rejected` are excluded. An unclassified terminal stage-run write fails this test, and it fails against the pre-fix `skipRemainingStages` patch containing only `status: "skipped"`.
- [x] `v2/src/daemon/pipeline-stage-dispatch.test.ts` — `every terminal pipeline stage-run write carries endedAt`; Keystone checkpoint: its test body carries `// @mutate v2/src/daemon/pipeline-execution.ts "store.updateStage({ pipelineId, stageId: record.stageId, branchKey, patch: { status: \"skipped\", endedAt: Date.now() } });" -> "store.updateStage({ pipelineId, stageId: record.stageId, branchKey, patch: { status: \"skipped\" } });"`, restoring the finishless caller patch, and the mutation turns the regression RED.
- [x] `v2/src/daemon/pipeline-stage-dispatch.test.ts` — `every terminal pipeline stage-run write carries endedAt`; Mutation checkpoint: the linked terminal-patch mutation proves the inventory rejects a newly finishless classified settlement writer.
- [x] `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md` describe the explicit `endedAt` guarantee for terminal stage-run statuses only, including skipped suffix/default rows, and explicitly exclude approval decisions.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § Pipeline stage dispatch and ordered progression — every daemon terminal stage-run settlement patch (`succeeded`, `failed`, `interrupted`, or `skipped`), including skipped suffix/default rows, carries `endedAt`; approval decisions are excluded.
- `v2/docs/v1-behaviors.md` — record the daemon settlement-writer guarantee for terminal stage-run statuses and its approval-decision exclusion.
