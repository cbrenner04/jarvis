# 01 - Write step delivers the report before the completion boundary

## Problem

The reporter from subspec 00 has no caller. The agent never learns which of its changed lines
no test executes, so the never-executed gap is first surfaced by the mutation verifier — after
the completion boundary, commit, push, PR, and a green ready gate.

Deliver the report to the agent inside the write step, before the completion boundary, advisory only.

## Decisions

- Run the reporter after the write step returns a `complete` result and before
  `store.commitCompletionBoundary` — rules out both the ready-gate slot (after the boundary,
  reproducing the late-and-expensive failure) and the per-iteration prompt placeholder (most runs
  complete on iteration 1, so the agent would never see a report).
- Deliver it as one advisory re-prompt through the existing `promptId` / `promptPlaceholders`
  swap that `runReadyRepairIteration` uses, under a new `write.coverage-advisory` registry
  artifact — rules out a fresh invocation path.
- The advisory re-prompt is a sub-invocation of the completing iteration, like `write.token-reprompt`:
  it consumes no iteration budget and cannot push the run past `maxIterations` — rules out an
  advisory pass that starves the ready-gate repair budget.
- The completing boundary commits as `complete` regardless of what the advisory re-prompt returns,
  including `blocked` or a failed invocation — rules out an advisory signal that can change or fail
  a run's outcome.
- Skip the re-prompt entirely when the reporter returns no uncovered lines or no report — rules out
  paying an agent invocation to say "nothing to report".
- Run the reporter only on the `complete` path — rules out paying a coverage suite on `progress`,
  `blocked`, and failure outcomes.
- Any work the agent does during the advisory pass lands in the completion commit, which runs
  after the boundary; no re-verification of the report follows.

## Acceptance criteria

- [ ] A completing write run with uncovered changed production lines re-prompts the agent once with
      the report before the completion boundary is committed.
- [ ] That run still commits a `complete` boundary and proceeds to the existing completion,
      publication, ready-gate, and mutation-verification path.
- [ ] The run's outcome and status are unchanged by the advisory pass, including when the advisory
      re-prompt returns `blocked` or fails to invoke.
- [ ] The advisory pass consumes no iteration budget: `iterationsConsumed` is identical to a run
      with no uncovered lines.
- [ ] A completing run with no uncovered changed lines issues no advisory invocation and no
      coverage run beyond the reporter's single scoped run.
- [ ] Non-`complete` outcomes (`progress`, `blocked`, invocation failure) trigger no reporter call.
- [ ] The `write.coverage-advisory` prompt is registered in `prompts/registry.txt`, states that an
      executed line may still be unasserted and that the mutation verifier decides adequacy, and
      states that adding coverage is optional and will not block the run.
- [ ] The prompt and the harness contain no coverage percentage, ratio, or threshold.
- [ ] `write-loop.test.ts` gains a test driving a completing run whose injected reporter returns
      uncovered lines, asserting the advisory invocation fires before the boundary commit and the
      outcome stays `complete`; it fails against the pre-change code.
- [ ] Tests fail when each added guard is inverted: inverting the empty-report guard makes the
      no-uncovered-lines case issue an advisory invocation; inverting the `complete`-only guard
      makes a `progress` iteration call the reporter.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the advisory coverage pass in the write loop's boundary ordering,
  and `write.coverage-advisory` in the write-step prompt inventory.
- `v2/docs/test-writing.md` — coverage is a pre-filter for never-executed lines; assertion adequacy
  remains the mutation gate's job.
- `v2/docs/operator-runbook.md` § Gate trust — the advisory report certifies execution, not
  assertion, and never gates a run.
