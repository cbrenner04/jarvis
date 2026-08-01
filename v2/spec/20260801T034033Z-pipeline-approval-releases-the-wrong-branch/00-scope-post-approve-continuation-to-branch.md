# Scope post-approve continuation to approved branchKey

## Problem

After intent fan-out, one `pipeline_approve` on a per-branch gate (e.g. `approve-intent`) marks that branch `approved`, then `applyPipelineApprovalDecision` calls `continuePipeline` with no `branchKey` and `runPipeline` walks every `activeSplit.branchKeys`. Sibling branches whose gate is still `awaiting` can have their next workflow stage dispatched — an awaiting gate does not withhold its own branch. Observed on `full-review` when ordering dependent fan-out branches via held gates.

## Surface

Primary: `v2/src/daemon/pipeline-execution.ts` (`applyPipelineApprovalDecision`, `continuePipeline`, `runPipeline` successor selection). Tests: `pipeline-execution.test.ts`. Docs: `v2/docs/operator-runbook.md`, `v2/docs/daemon-host.md`, `v2/docs/v1-behaviors.md`.

Out of scope: CLI approve/reject wiring (already branch-scoped), `pipeline list` / `wait` projection, single-default-branch pipelines, resume reopen for failed rows.

## Prerequisites

- `applyPipelineApprovalDecision` detaches `continuePipeline(pipelineId, deps)` with no `branchKey` after an applied approve (`pipeline-execution.ts`).
- `runPipeline` suffix loop iterates every `activeSplit.branchKeys` with no continuation context (`pipeline-execution.ts`).
- `pipeline_approve` / `commitPipelineApprovalDecision` persist branch-scoped decisions; duplicate approve on the same branch refuses `status_not_awaiting` (`state-store.ts`, `pipeline-execution.test.ts`).

## Decisions

- Post-approve continuation passes the approved `branchKey` into successor selection — rules out pipeline-wide suffix walks on every approve.
- Optional approved `branchKey` on continuation limits suffix selection to that branch; omission preserves all-branch walks for recovery/resume paths — rules out prescribing API shape while pinning the contract.
- Only the approved branch's eligible successor stages dispatch; a branch whose gate is `awaiting` is never dispatched — rules out treating one approval as a token for all branches.
- Fix dispatch selection in the continuation path, not list/wait projection — rules out "display is wrong"; refusal path already keys on `branchKey`.
- Post-approve continuation is scoped to the approved `branchKey`; continuation without that context (`recoverContinuablePipelines`, restart recovery) may still walk all actionable branches — per-branch gate blocking must continue to withhold `awaiting` siblings on those paths — rules out narrowing recovery by accident.
- `pipeline-execution.test.ts` — `pipeline approve and reject stay isolated per branchKey` approves the **first** fan-out `branchKey` (`alpha`) on a post-plan shared gate; sibling withholding on that path does not prove non-first approval is safe — rules out treating the preservation test as coverage for this defect.
- `pipeline-execution.test.ts` — `pipeline approve and reject stay isolated per branchKey` stays green — rules out regressing post-plan shared-gate isolation.
- Out of scope: single-default-branch pipelines and resume reopen for one failed row — rules out duplicating existing resume specs.

## Task checklist

- Thread approved `branchKey` from `applyPipelineApprovalDecision` through post-approve `continuePipeline` into `runPipeline` suffix selection so only that branch's continuable suffix runs until the next approval gate.
- Reproduce the bug on a fan-out with per-branch approval gates immediately after split, approving the **non-first** `branchKey` while the first sibling's gate stays `awaiting` (existing fan-out definition suffices; `approve-intent` naming is optional `full-review` fidelity).
- Add regression tests and guard-inversion checkpoint per acceptance criteria.
- Update operator-runbook, daemon-host, and v1-behaviors per documentation updates.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` — `approve-intent continuation dispatches only the approved branchKey` fails against current dispatch (starts the held sibling's `plan` while its gate is `awaiting`) and passes after the fix: on a two-branch fan-out with per-branch gates immediately after split, approve the **non-first** `branchKey` while the first sibling's gate remains `awaiting`; that approve dispatches only that branch's next stage (`plan`) through `dispatchLog` (or equivalent dispatch evidence) and stage status; the held sibling's `plan` stays `pending` with no dispatch on the held `branchKey` and no stage on that branch `running` while its gate is `awaiting`.
- [ ] `pipeline-execution.test.ts` — `approving both fan-out branches dispatches each successor on its own branchKey` fails against current dispatch and passes after the fix: same fixture, approve **non-first then first**; after the first approve, only that branch's next stage until the next approval gate is dispatched (dispatch + status); after the second approve, only the second branch's next stage until its next approval gate is dispatched; neither approve releases the other branch's successor prematurely.
- [ ] Source-mutating successor selection back to pipeline-wide suffix walk (or equivalent first-pending-wins across branches) turns `approve-intent continuation dispatches only the approved branchKey` RED, with a comment checkpoint naming the mutation. Do not add a production test flag.
- [ ] `pipeline-execution.test.ts` — `pipeline approve and reject stay isolated per branchKey` stays green.
- [ ] `bun run typecheck` exits zero.
- [ ] `bun run test:v2` exits zero.

## Documentation updates

- `v2/docs/operator-runbook.md` § Pipeline approve and reject — preserve that approve/reject does not mutate sibling **gate rows**; add that post-approve **successor dispatch** is scoped to the approved `branchKey` only (sibling gates stay `awaiting` and sibling stages are not dispatched).
- `v2/docs/daemon-host.md` — pipeline approve continuation semantics: post-approve continuation scoped to the approved `branchKey`; recovery paths without that context may walk all actionable branches.
- `v2/docs/v1-behaviors.md` — record post-approve fan-out continuation scoped to the approved `branchKey`.
