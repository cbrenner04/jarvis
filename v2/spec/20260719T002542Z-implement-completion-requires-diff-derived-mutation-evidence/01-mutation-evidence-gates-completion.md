# Mutation evidence gates implement completion

Wire the diff-derived mutation verifier (subspec 00) into the implement
completion path as a mandatory boundary, so a green suite alone can no longer
certify completion. A surviving mutation fails completion with the mutation and
source site named; mutated verification state is never published.

## Decisions

- Run mutation verification in the shared completion boundary after the scoped ready gate proves green and before the draft→ready flip; rules out certifying on the green gate alone and rules out running against a red baseline where survival is meaningless.
- Reuse the completion boundary's run base and scoped-test resolution; rules out a second base/scope derivation that could diverge from the ready gate.
- A surviving mutation stops completion (run is not reported `completed`) with the mutation and source site named; rules out an optional review preset an operator can omit and an undiagnosed generic gate failure.
- A spec/doc-only completion yields zero candidates and proceeds to `completed`; rules out blocking non-production completions on an empty mutation check.
- Restore the worktree before settling any terminal outcome; rules out publishing mutated bytes.

## Task checklist

- Invoke the subspec 00 verifier in `publishCompletionArtifacts` after the ready gate and before the flip, threading the boundary's run base and worktree.
- Classify a surviving-mutation result into a completion failure that keeps the run out of `completed` and names the mutation + site.
- Ensure the worktree is clean before the terminal result is returned.
- Update the four durable docs listed below.

## Acceptance criteria

- [ ] Implement completion runs diff-derived mutation verification as a mandatory boundary after the scoped ready gate and before the draft→ready flip; it is not an optional review preset that can be omitted.
- [ ] A surviving mutation fails completion: the run does not report `completed`, and the failure names the surviving mutation and its source site.
- [ ] A completion whose changed production guards are all caught, or that has zero candidates, proceeds to report `completed`.
- [ ] After a surviving-mutation failure the external worktree carries no mutated bytes.
- [ ] A new test drives the real completion path (injected finalize/scoped-test seams) to a non-`completed` outcome for an uncovered changed guard, asserting the run is not `completed` and the mutation and source site are named, and to `completed` for a fully-covered change; it fails against the pre-fix path (completion certifies on the green gate alone) and passes after.
- [ ] `v2/docs/workflow-runner.md`, `v2/docs/write-behavior.md`, `v2/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md` are updated per the Documentation updates section.

## Documentation updates

- `v2/docs/workflow-runner.md` — adversarial verification ordering in the completion boundary and failure settlement.
- `v2/docs/write-behavior.md` — completion semantics: `completed` now requires diff-derived mutation evidence.
- `v2/docs/operator-runbook.md` — replace the green-gate caveat with the remaining runtime-smoke limitation.
- `v2/docs/v1-behaviors.md` — record the stronger v2 implement completion guarantee.
