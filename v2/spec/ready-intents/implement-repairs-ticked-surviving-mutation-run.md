---
name: implement-repairs-ticked-surviving-mutation-run
---

# Implement repairs a ticked run with a surviving mutation

## Problem

After an implement agent ticks every acceptance criterion, a later
`surviving_mutation_failed` outcome leaves the branch complete by the spec but
under-covered by verification. `jarvis run workflow implement` then returns
`implement.already_complete`, so recovery requires unticking work or editing and
publishing the branch by hand.

## Decisions

- `jarvis run workflow implement` admits an all-ticked spec only when its latest durable outcome belongs to that spec's current implement-run lineage and retained worktree/branch, and is `surviving_mutation_failed`; rules out deriving `already_complete` from the spec tree alone or admitting stale or unrelated failed rows.
- Recovery continues from that lineage's completed write boundary in its owning worktree and invokes only bounded mutation-coverage repair; rules out stale-workspace retirement, criteria unticking, and write-step replay.
- One invocation owns repair, mutation re-verification, the ready gate, and publication; rules out a manual multi-command tail.
- Exhausted repair settles `mutation_repair_exhausted` after a finite attempt budget; rules out an unbounded agent loop.

## Acceptance criteria

- [ ] `v2/src/commands/workflow.test.ts` drives an all-ticked spec whose latest outcome in its current implement-run lineage settled `surviving_mutation_failed` and proves `jarvis run workflow implement` advances it instead of returning `implement.already_complete`; stale or unrelated failed rows do not admit recovery, and the test fails against the baseline.
- [ ] Recovery leaves every criterion ticked and records zero additional `patch.prompt.body` write-step invocations.
- [ ] Successful repair kills the mutation, reruns the ready gate and publication, and settles the workflow `completed`.
- [ ] A genuinely complete spec with no latest failed verification still returns `implement.already_complete` before worktree or agent side effects; existing preflight coverage stays green.
- [ ] Repair that does not kill the mutation stops at the finite budget and settles `mutation_repair_exhausted`.
- [ ] Inverting the failed-verification admission guard turns the command regression RED.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust and § Publication / completion failures — document the one-command recovery over ticked criteria.
- `v2/docs/workflow-runner.md` — document the `already_complete` exception and bounded mutation-repair continuation.
- `v2/docs/v1-behaviors.md` — record the changed v2 implement preflight and recovery contract.

## Prerequisites

- A durable review-owned `surviving_mutation_failed` row identifies its spec, implement-run lineage, retained worktree/branch, and completed sibling write boundary so only its owner can resume mutation re-verification, the ready gate, and publication without replaying that write step.
