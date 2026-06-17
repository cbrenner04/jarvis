# Run `ready` once at completion, reuse on unchanged tree

## Problem

`jarvis1 run` never runs `bun run ready` during the implementation loop, so the
first verification happens in a post-completion gate. Three gates run it
independently on the same commit: the shrink pre-gate (`shrink.ts`), the review
baseline gate (`review.ts`), and the review-skipped `maybeMarkReady` (`pr.ts`)
each call `runReadyAndCommit`. On the common path — no-op shrink, unchanged tree
— that is two full suite runs back-to-back re-proving an already-green tree.

This is harness work in the v1 engine (`v1/src/modes/patch/run.ts`,
`shrink.ts`, `review.ts`, `pr.ts`, `v1/src/ready-gate.ts`). Completion is still
measured by checkbox transitions; this slice only moves *where* `ready` runs and
removes the redundant re-runs.

## Behavior

Run `bun run ready` once at the completion transition (the tick that empties the
active subspec's checklist, reaching zero unchecked boxes), harness-side
wall-clock, zero agent tokens, via the existing `runReadyAndCommit` path. The
gate runs only when `git: true` (it commits/pushes any `check:fix` mutation, as
`runReadyAndCommit` already does). On success, record the green result keyed to
the resulting tree state: HEAD sha plus a clean worktree.

The three post-completion gates stop running `ready` unconditionally. Each
checks the recorded green result first: when the current tree is unchanged since
the recording (same HEAD sha, clean worktree) the gate reuses the green result
and skips its own `ready`; when the tree changed (e.g. a `shrink:` commit
landed, or a `check:fix` commit mutated the tree) the gate re-runs `ready` and
re-records. The gates affected are the shrink pre-gate, the review baseline
gate, the review final gate, and the review-skipped `maybeMarkReady`.

Net on the common path: one `ready` per completed spec instead of two-plus.

Green path only. When the completion-transition `ready` is red, this slice does
not record a green result and changes nothing else: the run falls through to
today's post-completion behavior unchanged (the gates run `ready` as they do
now), so the slice ships without a red regression. Red loop-back at the
completion gate is a separate intent. This slice does not auto-tick or judge
acceptance-criteria content.

## Decisions

One harness-side `ready` at the completion transition, reused downstream — rules out today's redundant per-gate re-runs on an unchanged tree, and rules out pushing `bun run ready` per-iteration onto the agent.
Reuse is keyed on tree state (HEAD sha + clean worktree), not a bare boolean — rules out reusing a stale green result after shrink or a `check:fix` commit mutates the tree.
Reuse the existing `runReadyAndCommit` capture, not a second runner — rules out a bespoke ready runner that could drift from the `check:fix` commit/push semantics.
Red at the completion gate preserves today's post-completion behavior — rules out coupling this slice to red loop-back so it can land alone.
The completion gate runs only under `git: true` — rules out a clean-tree key in loop-only mode, where there are no commits, no PR, and no post-completion gates to reuse it.

Deferred to first consumer: whether the recorded green result survives across separate `jarvis1 run` invocations — pin when a caller needs cross-run reuse (this slice records in-process only).

## Tasks

- Add an in-process green-result record keyed on HEAD sha + clean worktree, captured by the completion-transition `ready` run.
- Run `runReadyAndCommit` once at the completion transition in `tryFinishSpecIfDone` (or its `git: true` completion path), before shrink/review/`maybeMarkReady`, recording the green result on success.
- On a red completion-transition `ready`, record nothing and leave the existing post-completion gates to run `ready` as they do today.
- Guard the shrink pre-gate, review baseline gate, review final gate, and `maybeMarkReady` to reuse the recorded green result when the tree is unchanged and re-run `ready` otherwise.
- Update `v1/docs/run-loop.md` and `v2/docs/v1-behaviors.md` per Documentation updates.

## Acceptance criteria

- [ ] On a `git: true` patch run that completes with at least one implementation iteration, a no-op shrink, and an unchanged tree, `bun run ready` runs exactly once for the completed spec (down from two-plus today).
- [ ] The single `ready` runs at the completion transition (when the active subspec's last unchecked box is ticked, reaching zero unchecked boxes), harness-side, consuming zero agent tokens.
- [ ] The completion-transition `ready` runs through the existing `runReadyAndCommit` path: any `check:fix` mutation is committed and pushed before the run proceeds.
- [ ] After the completion-transition `ready` succeeds, a post-completion gate whose tree is unchanged (same HEAD sha, clean worktree) skips its own `ready` and reuses the green result.
- [ ] A post-completion gate whose tree changed since the recorded green result (e.g. a `shrink:` commit landed) re-runs `ready` instead of reusing.
- [ ] When the completion-transition `ready` is red, no green result is recorded and the post-completion gates run `ready` exactly as they do today (no behavior change on the red path).
- [ ] The completion-transition `ready` gate does not run when effective `git` is `false`.
- [ ] Completion is still measured by checkbox transitions only; the gate does not auto-tick or judge acceptance-criteria content.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v1/docs/run-loop.md`: describe the single completion-transition `ready` gate and the unchanged-tree reuse by the post-completion phases (shrink pre-gate, review baseline, review final, `maybeMarkReady`), replacing the per-gate unconditional re-run description. Note the green-path-only scope.
- `v2/docs/v1-behaviors.md`: record the completion-transition `ready` gate and the tree-keyed gate reuse as the v1 parity baseline, updating the review-phase and shrink entries that currently describe each gate running `ready` independently.
