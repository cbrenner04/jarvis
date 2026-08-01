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
- Linkage: only **ticked non-human-only** criteria whose text references `Mutation checkpoint:` trigger verification; resolve each `// Mutation checkpoint:` comment from the pinning test file named in that criterion (repo exemplar: `` `tui-entry.test.tsx` — … `Mutation checkpoint:` on that pin … ``); when a criterion names multiple pins, apply every linked checkpoint before accepting the tick — rules out scanning the whole worktree or verifying `(Manual)` rows.
- `spec.criteria-ticked` applies each linked inversion in the run worktree, runs scoped tests, and refuses the tick when the suite stays green — rules out agent self-police.
- Surviving inversion on a ticked mutation-checkpoint criterion settles `contract_miss` on `spec.criteria-ticked`, appends a harness `## Blocker` to the active subspec naming each hollow checkpoint (file, line, comment text), and records the same diagnostics on `contract_miss_detail` — rules out a bare contract miss or alternate settlement surface.
- Surviving inversion is a legitimate outcome (unreachable guard); the fix may delete the guard — rules out forcing a new test for dead code.
- Unparseable `Mutation checkpoint:` comments are reported and do not fail the run — rules out treating parse misses as contract_miss.
- Guard-inversion evidence stays source mutation on the real guard plus a pinning-test comment checkpoint; production invert hooks remain forbidden — rules out `setInvert*ForTest` / `invert*ForTest` / `invert*` parameters.
- General surviving-production-mutation policy stays out of scope — rules out expanding diff-derived post-commit verification in this intent.
- Deferred to first consumer: mechanical checkpoint parse grammar beyond repo exemplars — pin when the first unparseable-vs-hollow distinction needs a normative rule.
- Plan draft must name a failing-test file for new-behavior ACs (peer `guard-bare-settimeout`) — rules out prose-only ACs at plan time.

## Acceptance criteria

- [ ] A ticked non-human-only mutation-checkpoint criterion cannot complete when applying its linked checkpoint inversion leaves scoped tests green; the run reports checkpoint file, line, and comment text via `contract_miss` / `contract_miss_detail` and a harness `## Blocker` on the active subspec.
- [ ] The same criterion completes when applying the inversion turns a scoped test red.
- [ ] A `Mutation checkpoint:` comment the harness cannot mechanically apply is reported unparseable and does not fail the run.
- [ ] Regression fixtures replay merge-time worktrees from `20260801T142304Z-tui-entry-tree-viewport-and-navigation` and `20260801T160040Z-tui-entry-reversible-descend-navigation` (three evidence rows across those two trees, with their checkpoint comments) and detect each named inversion as surviving — not assertions against current `main` alone.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — what a ticked mutation-checkpoint criterion now proves.
- `v1/docs/spec-guidance.md` — how to write a checkpoint the harness can apply.
- `v2/docs/v1-behaviors.md` — criteria-ticked mutation-checkpoint verification behavior.

## Prerequisites

- Diff-derived mutation verification applies production-guard inversions and runs scoped test scripts.
- `parseSpec` assembles acceptance-criteria bullet blocks and classifies human-only markers.
- `spec.criteria-ticked` blocks implement `done` / `no-work` while any non-human-only acceptance criterion remains unchecked.
