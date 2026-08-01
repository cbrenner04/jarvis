---
name: criteria-ticked-verifies-mutation-checkpoints
---

# Implement completion verifies mutation-checkpoint criteria by executing named inversions

Splitting does not apply: checkpoint parsing/application and `spec.criteria-ticked` enforcement share the execution-loop implement completion boundary.

## Problem

Agents tick acceptance criteria asserting a named guard inversion turns a pinning test RED after
writing a `Mutation checkpoint:` comment. Nothing executes the inversion; unreachable guards and
misaligned checkpoints reach `main` as satisfied claims while scoped tests stay green.

## Decisions

- Mutation-checkpoint AC satisfaction requires executing the checkpoint-named inversion, not authoring the comment — rules out write-comment-and-tick.
- `spec.criteria-ticked` applies each linked `Mutation checkpoint:` inversion in the run worktree, runs scoped tests, and refuses the tick when the suite stays green — rules out agent self-police.
- A surviving inversion reports checkpoint file, line, and comment text — rules out a bare contract miss.
- Surviving inversion is a legitimate outcome (unreachable guard); the fix may delete the guard — rules out forcing a new test for dead code.
- Unparseable `Mutation checkpoint:` comments are reported and do not fail the run — rules out treating parse misses as contract_miss.
- Guard-inversion evidence stays source mutation on the real guard plus a pinning-test comment checkpoint; production invert hooks remain forbidden — rules out `setInvert*ForTest` / `invert*ForTest` / `invert*` parameters.
- General surviving-production-mutation policy stays out of scope — rules out expanding diff-derived post-commit verification in this intent.
- Deferred to first consumer: mechanical checkpoint parse grammar beyond repo exemplars — pin when the first unparseable-vs-hollow distinction needs a normative rule.

## Acceptance criteria

- [ ] A ticked mutation-checkpoint criterion cannot complete when applying its checkpoint-named inversion leaves scoped tests green; the run reports checkpoint file, line, and comment text.
- [ ] The same criterion completes when applying the inversion turns a scoped test red.
- [ ] A `Mutation checkpoint:` comment the harness cannot mechanically apply is reported unparseable and does not fail the run.
- [ ] Regression over the three 2026-08-01 evidence spec trees detects each named inversion as surviving against the tree that shipped it.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — what a ticked mutation-checkpoint criterion now proves.
- `v1/docs/spec-guidance.md` — how to write a checkpoint the harness can apply.
- `v2/docs/v1-behaviors.md` — criteria-ticked mutation-checkpoint verification behavior.

## Prerequisites

- Diff-derived mutation verification applies production-guard inversions and runs scoped test scripts.
- `parseSpec` assembles acceptance-criteria bullet blocks and classifies human-only markers.
- `spec.criteria-ticked` blocks implement `done` / `no-work` while any non-human-only acceptance criterion remains unchecked.
