# 01 - Post-completion shrink step

## Problem

Patch-run implementations accumulate bloat that `global.terse` and `patch.rules` do not remove once the agent is optimizing to tick acceptance criteria. A dedicated post-completion pass should simplify the run's diff without changing behavior.

## Decisions

- One shrink agent invocation per completed spec (not per implementation iteration), ruling out per-subspec or per-iteration shrink hooks.
- Post-completion order is shrink → review (when configured) → `maybeMarkReady`, ruling out shrink inside review debate or after PR readiness.
- Shrink runs only when `git: true` and at least one implementation iteration completed, ruling out loop-only runs and checkbox-only first-iteration completions.
- Pre-shrink gate runs `bun run ready` with the same commit/push semantics as the review baseline helper, ruling out shrink on a dirty worktree or uncommitted `check:fix` output.
- Shrink scope is the union of files touched by implementation iterations in the run, ruling out whole-branch PR/base diff scope (review-style).
- Completed spec tree is read-only during shrink; harness reverts spec-dir edits, ruling out prose rewrites that pass checkbox-only AC-intact checks.
- Contract miss (failing tests, deleted test file, regressed acceptance criterion) discards shrink changes and continues on pre-shrink code, ruling out aborting the run or blocking review/ready on shrink failure.
- Shrink does not consume `maxIterations`, ruling out shrink counting against the implementation iteration budget.
- Per-iteration `maybeMarkReady` defers when shrink or review will run, ruling out readying the PR before shrink on review-skipped runs.
- Shrink prompt hunts named bloat patterns only (no numeric line-count targets), ruling out "remove N%" goals.
- Non-empty shrink output commits once with `Jarvis-Agent:` trailer and PR footer refresh; no-op leaves no commit, ruling out per-file shrink commits.
- Deferred to first consumer: quota-exhaustion outcome when all patch agents fail during the single shrink invocation — pin when harness wires shrink (rotate within the invocation like patch iterations; default exit `2` if all exhausted, same as review).

## Tasks

- [ ] Add `prompts/patch/shrink.md` (registered prompt) with simplification checklist: derivable fields, pass-through wrappers, dead enum/status values, 1:1 tables, repeated test literals, docs restating signatures, machinery with no consumer yet.
- [ ] Register shrink prompt in prompt governance; cross-link `global.terse` / `patch.rules` as prevention surfaces in `v1/docs/prompt-governance.md`.
- [ ] Track implementation-iteration touched files across the run for shrink scope enforcement.
- [ ] Implement shrink phase in patch completion path (`tryFinishSpecIfDone` area): pre-shrink ready gate → one agent invocation → contract validation → commit or revert.
- [ ] Reuse patch review spec-tree revert helpers (`detectSpecTreeEdits` / `revertSpecTreeEdits`) for shrink.
- [ ] Extend per-iteration PR-ready deferral to cover pending shrink (not only pending review).
- [ ] Record shrink in telemetry with `patch_phase: "shrink"` distinguishable from implementation and review.
- [ ] Tests: phase order, scope boundary, spec read-only revert, contract-miss discard, no-op, defer `maybeMarkReady`, skip when `git: false` / zero implementation iterations, telemetry field.

## Acceptance criteria

- [ ] `git: true` runs with implementation iterations execute shrink after completion + clean worktree and before review or `maybeMarkReady`.
- [ ] Shrink runs only on files touched during implementation iterations; edits outside that set are reverted or never applied.
- [ ] Spec-tree edits during shrink are reverted; acceptance-criteria checkbox state is unchanged.
- [ ] A shrink pass that leaves tests red, deletes a test, or regresses an acceptance criterion is fully reverted; review/ready proceeds on pre-shrink code.
- [ ] A no-op shrink pass leaves the worktree unchanged and does not add a commit.
- [ ] A non-empty shrink pass produces one shrink commit with attribution trailer and refreshed PR footer.
- [ ] `maybeMarkReady` is not called from the per-iteration completion path while shrink is still pending.
- [ ] Shrink is skipped when `git: false` or when the run completed zero implementation iterations.
- [ ] Telemetry records the shrink invocation with `patch_phase: "shrink"`.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- [ ] `v1/docs/run-loop.md` — shrink step in patch lifecycle (order, guards, discard-on-miss).
- [ ] `v1/docs/prompt-governance.md` — register shrink prompt; cross-link prevention (`global.terse`, `patch.rules`) vs gate (`patch.shrink`).
- [ ] `v2/docs/v1-behaviors.md` — post-completion shrink phase behavior.
