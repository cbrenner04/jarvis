# 01 - Post-completion shrink step

## Problem

Patch-run implementations accumulate bloat that `global.terse` and `patch.rules` do not remove once the agent is optimizing to tick acceptance criteria. A dedicated post-completion pass should simplify the run's diff without changing behavior.

## Decisions

- One shrink agent invocation per completed spec (not per implementation iteration), ruling out per-subspec or per-iteration shrink hooks.
- Post-completion order is shrink → review (when configured) → `maybeMarkReady`, ruling out shrink inside review debate or after PR readiness.
- Shrink runs only when `git: true` and at least one implementation iteration completed, ruling out loop-only runs and checkbox-only first-iteration completions.
- Pre-shrink gate runs `bun run ready` with the same commit/push semantics as the review baseline helper on the success path; failure logs a warning and skips shrink (continues to review/`maybeMarkReady`), ruling out fatal shrink gate blocking completion.
- Scope allowlist accumulates paths from implementation iterations (`patch_phase` implementation or unset/default), excluding harness-only commits (checkbox, `check:fix`, PR-body) and spec-dir paths (read-only revert); out-of-scope edits reverted post-invocation, ruling out prompt honor system or whole-branch PR/base diff scope.
- Completed spec tree is read-only during shrink; harness reverts spec-dir edits, ruling out prose rewrites that pass checkbox-only AC-intact checks.
- AC regression: any criterion checked pre-shrink becomes unchecked post-shrink (checkbox state only; prose edits are spec-tree revert, not regression), ruling out prose-only change as regression signal.
- Deleted test: path under shrink scope with deletion status on repo test paths (e.g. `*.test.ts`), ruling out vague "test deleted" without path predicate.
- Any unsuccessful shrink (contract miss, quota exhaustion, timeout, spawn error) discards worktree changes and continues; shrink never elevates run exit code, ruling out shrink failure blocking completion paths.
- Shrink does not consume `maxIterations`, ruling out shrink counting against the implementation iteration budget.
- `patch_phase: "shrink"` excluded from `patchIterationsCompletedForSummary` and `isImplementationAttempt`, mirroring `"review"`, ruling out shrink inflating implementation counts / `shouldRunReview` gating.
- Per-iteration `maybeMarkReady` defers when shrink or review will run, ruling out readying the PR before shrink on review-skipped runs.
- Shrink assembly follows patch-mode patterns: run-scoped diff (not full branch), explicit file allowlist, spec-tree read-only instruction; inject `patch.prompt.shrink` + `global.terse`, not `patch.rules`, ruling out full patch rules conflicting with simplification objective.
- Shrink prompt hunts named bloat patterns only (no numeric line-count targets), ruling out "remove N%" goals.
- Non-empty shrink output commits once with `Jarvis-Agent:` trailer and PR footer refresh; no-op leaves no commit, ruling out per-file shrink commits.
- Deferred to first consumer: quota-exhaustion outcome when all patch agents fail during the single shrink invocation — pin when harness wires shrink (rotate within the invocation like patch iterations; default exit `2` if all exhausted, same as review).
- Deferred to first consumer: re-run shrink on already-complete spec — pin when resume/re-run semantics are exercised. Default: once per completion transition per run session, not on every re-invocation against a complete index (mirror review).

## Tasks

- [ ] Add `prompts/patch/shrink.md` registered as `patch.prompt.shrink` with simplification checklist: derivable fields, pass-through wrappers, dead enum/status values, 1:1 tables, repeated test literals, docs restating signatures, machinery with no consumer yet.
- [ ] Register `patch.prompt.shrink` in prompt governance; cross-link `global.terse` / `patch.rules` as prevention surfaces vs `patch.prompt.shrink` as gate in `v1/docs/prompt-governance.md`.
- [ ] Implement shrink prompt assembly: run-scoped diff, explicit allowlist, spec-tree read-only; inject `patch.prompt.shrink` + `global.terse`, not `patch.rules`.
- [ ] Track implementation-iteration touched files across the run for shrink scope allowlist and post-invocation out-of-scope revert.
- [ ] Implement shrink phase in patch completion path (`tryFinishSpecIfDone` area): pre-shrink ready gate → one agent invocation → contract validation → commit or revert.
- [ ] Reuse patch review spec-tree revert helpers (`detectSpecTreeEdits` / `revertSpecTreeEdits`) for shrink.
- [ ] Extend per-iteration PR-ready deferral to cover pending shrink (not only pending review).
- [ ] Exclude `patch_phase: "shrink"` from `patchIterationsCompletedForSummary` and `isImplementationAttempt`.
- [ ] Record shrink in telemetry with `patch_phase: "shrink"` distinguishable from implementation and review.
- [ ] Tests: phase order, scope boundary, spec read-only revert, contract-miss discard, unsuccessful-invocation discard, no-op, defer `maybeMarkReady`, skip when `git: false` / zero implementation iterations / pre-shrink ready failure, run-summary exclusion, telemetry field.

## Acceptance criteria

- [x] `git: true` runs with implementation iterations execute shrink after completion + clean worktree and before review or `maybeMarkReady`.
- [x] Shrink runs only on files touched during implementation iterations; edits outside that set are reverted post-invocation.
- [x] Spec-tree edits during shrink are reverted; acceptance-criteria checkbox state is unchanged.
- [x] A shrink pass that leaves tests red, deletes a test file under shrink scope on repo test paths, or regresses an acceptance criterion (checked pre-shrink → unchecked post-shrink) is fully reverted; review/ready proceeds on pre-shrink code.
- [x] Any other unsuccessful shrink invocation (quota exhaustion, timeout, spawn error) discards worktree changes and continues without elevating run exit code.
- [x] Pre-shrink `bun run ready` failure logs a warning, skips shrink, and continues to review/`maybeMarkReady`.
- [x] A no-op shrink pass leaves the worktree unchanged and does not add a commit.
- [x] A non-empty shrink pass produces one shrink commit with attribution trailer and refreshed PR footer.
- [x] `maybeMarkReady` is not called from the per-iteration completion path while shrink is still pending.
- [x] Shrink is skipped when `git: false` or when the run completed zero implementation iterations.
- [x] Telemetry records the shrink invocation with `patch_phase: "shrink"`.
- [x] `patch_phase: "shrink"` is excluded from `patchIterationsCompletedForSummary` and run-summary implementation attempt counts (`isImplementationAttempt`).
- [x] `bun run typecheck` and `bun test` pass.

## Documentation updates

- [ ] `v1/docs/run-loop.md` — shrink step in patch lifecycle (order, guards, discard-on-miss).
- [ ] `v1/docs/prompt-governance.md` — register `patch.prompt.shrink`; cross-link prevention (`global.terse`, `patch.rules`) vs gate (`patch.prompt.shrink`).
- [ ] `v2/docs/v1-behaviors.md` — post-completion shrink phase behavior.
