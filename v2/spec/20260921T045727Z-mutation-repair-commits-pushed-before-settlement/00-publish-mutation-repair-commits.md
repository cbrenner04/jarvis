# Publish mutation-repair commits before settlement

## Problem

`runMutationRepairAttempt` commits a completed repair and then runs diff-derived mutation verification before publication. A surviving mutation returns directly to the repair loop, so repeated survivors can leave every `mutation-repair` commit local when the row settles `mutation_repair_exhausted`; abort or kill in that interval has the same gap. The draft PR and its CI still describe the pre-repair tree.

## Decisions

- Enter push-only completion publication after each successful mutation-repair commit and before verification, retry, abort, kill, or terminal settlement; rules out batching repair commits until mutation verification is clean.
- Keep ready finalization after clean mutation verification only; rules out flipping the draft PR while publishing an unverified repair commit.
- Preserve the bounded repair count and existing terminal classifications; rules out converting `mutation_repair_exhausted` into a resumable outcome or treating a failed publication as synchronized.
- Exercise the real diff-derived verifier in the regression path; rules out a finalizer-only survivor stub, which already publishes on the pre-fix path and cannot reproduce the defect.

## Task checklist

- [ ] Reorder the review-mutation repair continuation so each successful `mutation-repair` commit receives push-only publication before mutation verification, retry, abort, kill, or terminal settlement.
- [ ] Keep draft-to-ready finalization after clean mutation verification, not repair-commit publication.
- [ ] Add focused resume regression coverage for repeated confirmed survivors, including exhaustion, a later blocked or unsettled repair, and abort or kill after a repair commit, that observes each distinct committed tip at the publisher before retry or terminal settlement.
- [ ] Keep successful repair completion and existing publication-failure settlement behavior covered.
- [ ] Update the durable mutation-repair and operator guidance.

## Acceptance criteria

- [ ] After every successful mutation-repair completion commit, push-only publication observes that distinct commit as `HEAD` before the loop starts another repair attempt or writes any terminal boundary.
- [ ] Repair-commit publication preserves the draft PR; ready finalization occurs only after clean mutation verification.
- [ ] A `mutation_repair_exhausted` row retains no mutation-repair commit ahead of the published branch/PR head; this condition is reachable on the pre-fix path in `v2/src/execution/workflow-runner-resume.ts` when its direct diff-derived verification returns `surviving-mutation` before `publishWithReadyRepair`.
- [ ] Regression tests in `v2/src/execution/workflow-runner-resume-review-dispatch.test.ts` drive the real prepublication verifier through repeated confirmed survivors, record every distinct repair `HEAD` delivered to the publisher before retry or settlement, and prove the final repair tip is published before `mutation_repair_exhausted`; they fail against the pre-fix code.
- [ ] Regression coverage proves a successful earlier repair commit remains published when a later mutation-repair invocation reports blocked or unsettled, and when abort or kill arrives after a repair commit before publication.
- [ ] Existing success and publication-failure tests in `v2/src/execution/workflow-runner-resume-review-dispatch.test.ts` stay green.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- Update `v2/docs/write-behavior.md` with the mutation-repair commit → publication → verification/settlement ordering.
- Update `v2/docs/operator-runbook.md` under **Flip-and-test false-positive check** to record that a false positive can exhaust mutation repair while every repair commit remains synchronized with the branch/PR head.
- Update the mutation-repair entry in `v2/docs/v1-behaviors.md` to record that each repair commit is published before retry or terminal settlement.
