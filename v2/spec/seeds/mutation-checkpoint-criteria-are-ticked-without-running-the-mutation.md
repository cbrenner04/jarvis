---
name: mutation-checkpoint-criteria-are-ticked-without-running-the-mutation
---

# Agents tick "inverting this guard turns the pin RED" criteria without ever running the inversion

## Problem

Plans routinely emit acceptance criteria of the form *"reintroducing X turns pin Y RED;
`Mutation checkpoint:` names that inversion"*. Agents tick them after writing the comment. Three
times in one session the named mutation turned **nothing** red — twice because the guard had become
unreachable, once because the state it guards is not observable from the test seam. The completion
contract treats a ticked criterion as satisfied, the ready gate is green either way, and the false
claim reaches `main` inside a merged spec.

The criterion is not wrong to want. It is unverifiable by the agent as written, because nothing
executes the inversion.

## Evidence

All 2026-08-01, all found by post-merge review, all corrected by hand:

| Spec | Criterion | Reality |
| --- | --- | --- |
| `20260801T142304Z-tui-entry-tree-viewport-and-navigation` | selection-driven list collapse turns nav pin RED | reverted it; 216 pass / 0 fail |
| same | omitting measured dims from `currentState` turns alignment pin RED | reverted it; 216 pass / 0 fail |
| `20260801T160040Z-tui-entry-reversible-descend-navigation` | `ids[0]` fallthrough turns reversible-walk pin RED | reverted both fallthroughs; 226 pass / 0 fail |

In each case the guard was unreachable in any state the tests can construct — the earlier slices in
the same chain had removed the path that reaches it. The agent wrote a truthful-looking comment
naming a mutation that cannot fire.

## Decisions

- A criterion asserting that a named mutation turns a test red is verified by **executing** that mutation, not by writing the checkpoint comment. Rules out the current write-comment-and-tick loop.
- The harness owns the execution: the completion path applies each `Mutation checkpoint:` comment's named inversion in the run's worktree, runs the scoped tests, and refuses the tick when the suite stays green. Rules out asking the agent to self-police the same claim it just made.
- A checkpoint whose inversion leaves the suite green is reported with the file, line, and comment text, so the operator sees which claim was hollow. Rules out a bare failure that sends the operator hunting.
- An unreachable guard is a legitimate outcome, not only a test gap — the report says the mutation survived, and the fix may be deleting the guard rather than adding a test. Rules out forcing a test for dead code.
- Out of scope: the general surviving-production-mutation policy, and `Mutation checkpoint:` comments that name a mutation in prose too loosely to apply mechanically — those are reported as unparseable, not as failures.

## Acceptance criteria

- [ ] A subspec criterion naming a mutation checkpoint cannot be ticked when applying that mutation leaves the scoped tests green; the run reports the file, line, and comment text.
- [ ] The same criterion completes when applying the mutation turns a scoped test red.
- [ ] A `Mutation checkpoint:` comment the harness cannot mechanically apply is reported as unparseable and does not fail the run.
- [ ] The three evidence rows above reproduce: each named inversion is detected as surviving against the spec tree that shipped it.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — what a ticked mutation-checkpoint criterion now proves.
- `v1/docs/spec-guidance.md` — how to write a checkpoint the harness can apply.

## Prerequisites

- `v2/src/execution/diff-derived-mutation-verifier.ts` — existing mutation application and scoped-test runner
- `shared/spec-parser.ts` — criterion parsing and `isHumanOnlyCriterion`
- `v2/src/execution/implement-workflow-steps.ts` — the spec.criteria-ticked completion contract
