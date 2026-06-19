# Harness gate tier wiring

Post-completion gates either skip `ready` entirely (unchanged tree) or re-run the
full pipeline (changed tree). The review final gate always runs full `ready` before
`gh pr ready`. Happy path runs the full suite twice (completion + review final).

Depends on `00` (tiered `scripts/ready.ts`).

## Decisions

- `runReadyAndCommit` remains the harness entry point; add a `tier: "fast" | "full"` option threaded through its `runReady` seam; rules out bypassing the commit-on-green contract or spawning tier logic outside `ready-gate.ts`.
- Completion-transition gate always calls `runReadyAndCommit` with `full`; rules out fast tier at the first green proof.
- Shrink pre-gate, review baseline gate, and `maybeMarkReady` call `fast` when `isTreeUnchangedSinceRecordedGreen` is true and `full` when false; rules out unchanged-tree skip with no re-verification.
- Review final gate skips `runReadyAndCommit` entirely when `isTreeUnchangedSinceRecordedGreen` is true, then proceeds to `gh pr ready` only with a clean worktree (predicate unchanged); rules out unconditional full ready and rules out running `fast` before `gh pr ready` on the unchanged path.
- Review final gate runs `full` when the tree changed or no recorded green exists; rules out `fast` tier at the draft→ready flip.
- `check:fix` commit path in `runReadyAndCommit` runs only after a `full` tier invocation (fast tier cannot dirty the tree via `check:fix`); rules out committing after `fast`.
- Plan-mode `runReadyAndCommit` call sites keep default `full`; rules out changing plan ready semantics in this spec.
- Deferred to first consumer: telemetry/log strings naming the active tier — pin when an operator-facing transcript needs tier labels.

## Tasks

- [ ] Add `tier` to `RunReadyAndCommitOpts` and wire it through the default `bun run ready` subprocess seam.
- [ ] Completion transition (`run.ts`): pass `full`.
- [ ] Shrink pre-gate (`shrink.ts`), review baseline (`review.ts`), `maybeMarkReady` (`pr.ts`): `fast` on unchanged tree, `full` on changed; refresh recorded green after a successful `full` re-run.
- [ ] Review final gate (`review.ts`): reuse (skip ready) on unchanged tree; `full` otherwise; preserve failure exit semantics.
- [ ] Update gate-reuse integration tests and add tier-observable seams where needed.
- [ ] Retire or rewrite the test asserting review final always runs ready unconditionally.

## Acceptance criteria

- [ ] Completion-transition gate invokes `runReadyAndCommit` with `full` tier.
- [ ] When HEAD and porcelain match the recorded completion green result, shrink pre-gate, review baseline gate, and `maybeMarkReady` each invoke `runReadyAndCommit` with `fast` tier (not `full`, not skip).
- [ ] When the tree changed or no green was recorded, those gates invoke `runReadyAndCommit` with `full` tier and refresh the recorded green carrier on success.
- [ ] When HEAD and porcelain match the recorded completion green result, review final gate skips `runReadyAndCommit` and calls `gh pr ready` with worktree still clean.
- [ ] When the tree changed before review final, review final gate runs `full` tier then `gh pr ready`.
- [ ] On the default common path (green completion gate, review enabled, no-op shrink, review makes no commits), exactly one `full` ready runs total across all gates (completion only); review final reuses without a second full run.
- [ ] Regression tests prove the tier matrix above via instrumented `runReady`/`runReadyAndCommit` seams or equivalent invocation logs.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes.

## Documentation updates

- [ ] `v1/docs/run-loop.md` documents `fast` vs `full` tier semantics, which gate uses which tier, install digest skip (from `00`), and review-final recorded-green reuse.
- [ ] `v2/docs/v1-behaviors.md` updates patch-mode ready gate bullets to match tiered behavior and revised review-final reuse (replaces unconditional final ready).

## Out of scope

- Shrink-phase test skipping (separate shrink intent; will consume `fast` tier when landed).
- Auto-tick on completion.
- Changing what `check:fix` or `check` cover.
