---
name: implement-completion-requires-diff-derived-mutation-evidence
---

# Implement completion requires diff-derived mutation evidence

An implement run can report `completed` when its changed production guards are
irrelevant to every test. Make adversarial mutation verification a mandatory
completion boundary, so a green suite alone cannot certify the implementation.

## Decisions

- Derive candidate mutations from the production diff against the run base; rules out a fixed generic mutation catalog that misses changed domain guards.
- Cover changed subprocess arguments, fail-closed guards, and destructive-operation safety choices when present; rules out limiting verification to syntax-level operator swaps.
- Require each applied mutation to make at least one scoped test fail; rules out accepting tests that stay green when the production behavior is broken.
- Treat a zero-candidate diff as a passing mutation check and record the run base, inspected production paths, and zero candidate count; rules out an unexplained skipped check.
- Fail completion with the surviving mutation and source site named; rules out an undiagnosed generic gate failure.
- Cap mutation count and total verification time while inspecting only changed production files; rules out a full-repository sweep dominating implement wall clock.
- Restore the implementation after every mutation and terminal outcome; rules out publishing mutated verification state.
- Run verification in the mandatory implement completion path after authored changes settle; rules out an optional review preset that operators can omit.

## Out of scope

- Runtime entrypoint smoke verification.
- Full-repository mutation coverage.
- A general-purpose mutation-testing product outside implement completion.

## Prerequisites

- Implement completion runs a ready gate whose tests are scoped from changed paths relative to the run base.

## Documentation updates

- `v2/docs/workflow-runner.md` — adversarial verification ordering and failure settlement.
- `v2/docs/write-behavior.md` — mutation selection, bounds, evidence, and completion semantics.
- `v2/docs/operator-runbook.md` — replace the green-gate caveat with the remaining runtime-smoke limitation.
- `v2/docs/v1-behaviors.md` — record the stronger v2 implement completion guarantee.
