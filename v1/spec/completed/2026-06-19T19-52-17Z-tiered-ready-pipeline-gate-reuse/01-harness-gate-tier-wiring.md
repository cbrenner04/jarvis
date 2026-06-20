# Harness gate tier wiring

**Current.** Post-completion gates skip `ready` on an unchanged tree or re-run the
full pipeline on a changed tree. Review final always runs full `ready` before
`gh pr ready`. Happy path runs the full suite twice (completion + review final).

**Target.** Completion transition runs `full` once and records green. Intermediate
gates (`fast` on unchanged tree, `full` on changed) cheaply re-proof without
install/check:fix/check. Review final skips `ready` when HEAD + porcelain still
match the completion recording; runs `full` only when the tree changed or no green
was recorded. Common path (green completion, review enabled, no-op shrink, review
makes no commits): exactly one `full` ready total.

Supersedes completed `01-gate-reuse`: intermediate gates change **skip → `fast`
tier**; review final changes **unconditional full → skip on unchanged tree /
`full` on changed**.

Depends on `00` (tiered `scripts/ready.ts`).

## Decisions

- `runReadyAndCommit` remains the harness entry point; add `tier: "fast" | "full"` and thread it through `JARVIS_READY_TIER` on the `runReady` subprocess seam; rules out bypassing the commit-on-green contract or spawning tier logic outside `ready-gate.ts`.
- `runReady` test seam becomes `(cwd: string, tier: "fast" | "full") => void` (default implementation sets env and spawns `bun run ready`); rules out tier matrix tests against the current `(cwd) => void` shape.
- Completion-transition gate always calls `runReadyAndCommit` with `full`; rules out `fast` at the first green proof.
- Red completion gate records no green; every gate that runs ready uses `full` until a new green is recorded; rules out `fast` reuse over a missing or stale carrier.
- Asymmetric reuse: shrink pre-gate, review baseline, per-iteration `maybeMarkReady`, and completion-transition `maybeMarkReady` share one `selectReadyTier(recordedGreen)` policy — `fast` when `isTreeUnchangedSinceRecordedGreen`, else `full`; review final **skips** `runReadyAndCommit` when the predicate holds (completion already ran `full`); rules out uniform skip or running `fast` before `gh pr ready`.
- Review final runs `full` when the tree changed or no recorded green exists; rules out `fast` at the draft→ready flip.
- `check:fix` commit path in `runReadyAndCommit` runs only after a `full` tier invocation; rules out committing after `fast`.
- `--resume-review` runs zero implementation iterations, so no completion gate and no in-run recorded green: review baseline and review final each use `full` even when the worktree is clean and HEAD unchanged; rules out inheriting completion-path `fast`/skip on resume.
- Plan-mode `runReadyAndCommit` call sites keep default `full`; rules out changing plan ready semantics in this spec.
- Deferred to first consumer: telemetry/log strings naming the active tier — pin when an operator-facing transcript needs tier labels.

## Tasks

- [x] Add `tier` to `RunReadyAndCommitOpts`; extend `runReady` seam to `(cwd, tier) => void`; default impl sets `JARVIS_READY_TIER`.
- [x] Extract shared `selectReadyTier(recordedGreen)` used by shrink pre-gate, review baseline, and both `maybeMarkReady` sites.
- [x] Completion transition (`run.ts`): pass `full`.
- [x] Shrink pre-gate (`shrink.ts`), review baseline (`review.ts`), per-iteration and completion-transition `maybeMarkReady` (`pr.ts`, `run.ts`): `selectReadyTier`; refresh recorded green after successful `full`.
- [x] Review final gate (`review.ts`): skip ready on unchanged tree; `full` otherwise; preserve failure exit semantics.
- [x] Rewrite skip-based gate-reuse tests (shrink, baseline, `maybeMarkReady`) to assert `fast` tier on unchanged tree.
- [x] Retire or rewrite the test asserting review final always runs ready unconditionally.
- [x] Add tier-matrix coverage for completion transition, no-review (`maybeMarkReady` only), and `--resume-review` (with and without in-run carrier).

## Acceptance criteria

- [x] Completion-transition gate invokes `runReadyAndCommit` with `full` tier.
- [x] When HEAD and porcelain match the recorded completion green result, shrink pre-gate, review baseline gate, per-iteration `maybeMarkReady`, and completion-transition `maybeMarkReady` each invoke `runReadyAndCommit` with `fast` tier (not `full`, not skip).
- [x] When the tree changed or no green was recorded, those gates invoke `runReadyAndCommit` with `full` tier and refresh the recorded green carrier on success.
- [x] When no green was recorded (red completion gate or `--resume-review` with no in-run carrier), every gate that runs ready uses `full`.
- [x] When HEAD and porcelain match the recorded completion green result, review final gate skips `runReadyAndCommit` and calls `gh pr ready` with worktree still clean.
- [x] When the tree changed before review final, review final gate runs `full` tier then `gh pr ready`.
- [x] On the default common path (green completion gate, review enabled, no-op shrink, review makes no commits), exactly one `full` ready runs total; review final reuses without a second full run.
- [x] With review passes `0` (no-review path), completion-transition `maybeMarkReady` follows the same `fast`/`full` matrix; no review baseline or final gate runs.
- [x] Under `--resume-review`, shrink is skipped; review baseline and review final each run `full` (no in-run carrier; test-injected `recordedGreenResult` must not downgrade to `fast` or skip).
- [x] Regression tests prove the tier matrix via the `(cwd, tier)` `runReady` seam or equivalent invocation logs.
- [x] `bun run typecheck` passes.
- [x] `bun run test` passes.

## Documentation updates

- [x] `v1/docs/run-loop.md`: gate tier matrix (which gate uses `fast`, `full`, or skip); review-final recorded-green reuse; supersession note for prior skip/unconditional-final semantics; cross-link tier step definitions and install digest skip to subspec `00`. Update exit-6 row: intermediate `fast` does not run `check:fix` or commit; review-final skip relies on predicate cleanliness; dirty tree forces `full` and the `check:fix` commit path.
- [x] `v2/docs/v1-behaviors.md`: replace (not append) patch-mode ready-gate bullets for tiered behavior, intermediate `fast` reuse, and revised review-final reuse.

## Out of scope

- Shrink-phase test skipping (separate shrink intent; will consume `fast` tier when landed).
- Auto-tick on completion.
- Changing what `check:fix` or `check` cover.
