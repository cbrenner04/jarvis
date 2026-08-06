---
name: plan-review-must-falsify-guard-premises
---

# Nothing falsifies a spec's premise until implement runs have already burned

## Problem

Plans routinely author criteria of the form *"rules out X"* / *"X may never equal Y"*. Such a criterion is only legitimate if X is reachable on `main` today. Nothing checks that. When the premise is wrong, the plan step's precision makes it worse — it converts a non-problem into exact, testable, confidently-worded criteria, and the error is only discovered after implementation, if at all.

The failure is silent in a specific way: a guard against an unreachable condition **cannot be killed by any mutation**, because its failure state cannot be constructed. That surfaces as a hollow mutation checkpoint, which reads like a proof-form problem and invites amending the criterion — which is the wrong repair and lets the next attempt through.

## Evidence

`20260803T002657Z-fan-out-stage-dispatch-preserves-workflow-ownership` (retired by #2562), subspec 00. Its criterion: *"Each sibling dispatch owns only its resolved destination `(project, branch)` worktree; neither destination may equal the predecessor worktree."*

Cost before anyone questioned the premise:

| Attempt | Outcome |
| --- | --- |
| `b40d6960` | blocked — hollow checkpoint, `status === "running"` skip guard |
| `f7d828bf` | blocked — hollow checkpoint, `ownershipKeysEqual` |
| `3a4dea01` | subspec 00 completed, then `iteration_timeout` on 01 |

Plus two operator spec amendments (#2552, #2553) that treated the hollow checkpoints as a proof-form problem, and a hand fold-in.

Adversarial review then disproved the premise in minutes: reverting `resolvePlanStage` to baseline semantics left **both** ownership regressions green. Plan destinations are `plan/${ready.name}`, derived per downstream ready-intent, on `main` too — destination never equalled predecessor. The shipped `destinationDistinctFromPredecessor` predicate has no production call site; it asserts an invariant that already held.

The check that would have caught it costs seconds and requires no code: *can this condition occur on `main` right now?*

## Decisions

- The plan **debate review** gains a required premise-falsification pass: for every criterion that
  asserts an invariant or rules out a condition, the reviewer must establish that the condition is
  reachable on the repository base today, citing a call path or a constructible scenario. A criterion
  whose violation cannot be demonstrated is rewritten or dropped before the spec lands — rules out
  discovering a dead premise only after implement runs. This goes in the plan review roles, not the
  intent-split prompt, which has already been extended and is the wrong seam.
- A dropped premise that leaves the subspec empty is reported as such rather than replaced with
  filler — rules out a review that preserves scope by inventing work.
- Implementation-time backstop: a subspec's headline behavior change carries one **keystone**
  `// @mutate` directive that reverts it to baseline semantics, distinct from its guard pins. A
  surviving keystone means the change is inert. Reuses `verifyMutationCheckpoints` unchanged — same
  apply/run/restore machinery, aimed at the core change instead of its guards — rules out shipping a
  no-op that passes its own tests.
- A full-diff revert is **not** the mechanism: new tests import new exports, so reverting everything
  yields a compile error rather than a red test. The keystone is a targeted semantic revert, which is
  what a directive already is.
- Out of scope: the intent-split prompt; mutation-checkpoint selection and directive resolution
  (both owned by `mutation-checkpoint-verifier-trust`).

## Acceptance criteria

- [ ] A plan debate review over a spec containing an invariant criterion whose violation is
      unreachable on the base reports that criterion as unfalsifiable and names it; a regression fails
      against the current review roles, which do not check premises.
- [ ] A plan debate review over a spec whose invariant criteria are all reachable reports no
      premise finding — the check does not fire on legitimate guards.
- [ ] A subspec whose headline change carries a keystone directive that survives its mutation is
      refused at completion with a named blocker distinguishing it from a hollow guard checkpoint.
- [ ] A keystone directive that turns its named test red completes normally, and a subspec with guard
      checkpoints but no keystone is refused rather than silently passing.
- [ ] Replaying the retired fan-out subspec 00 through the plan review reports its
      destination-vs-predecessor criterion as unfalsifiable.
- [ ] Mutation checkpoint: a `// @mutate` directive removing the keystone-survival refusal turns its
      regression RED.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` exit zero.

## Documentation updates

- `v1/docs/spec-guidance.md` — a criterion that rules out a condition must cite how that condition is
  reachable today; keystone checkpoints alongside guard checkpoints.
- `v2/docs/operator-runbook.md` § Gate trust — a surviving keystone means an inert change; a second
  hollow checkpoint on a different guard in the same subspec is a premise smell, not a proof-form
  problem.

## Prerequisites

- Plan debate review roles (`shared/prompts/review-plan.ts`)
- `verifyMutationCheckpoints` and directive resolution (`v2/src/execution/mutation-checkpoint-verifier.ts`)
- `mutation-checkpoint-verifier-trust` landed first — the keystone reuses
  `verifyMutationCheckpoints`, whose selection, resolution, and gate policy that bundle rewrites
