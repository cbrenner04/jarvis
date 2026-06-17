# Run `ready` once at the completion transition and record the green result

## Problem

`jarvis1 run` never runs `bun run ready` during the implementation loop —
completion is gauged purely by checkbox transitions. Verification is deferred to
the post-completion phases, each of which runs `ready` independently
(`shrink.ts` pre-gate, `review.ts` baseline, `pr.ts` `maybeMarkReady`). Nothing
runs `ready` at the moment the spec's checklist empties, and nothing records a
green result that later phases could reuse.

This subspec adds the single completion-transition `ready` run and the recorded
green result. It does not yet change the post-completion gates to reuse it (that
is `01`); after this subspec alone they still run `ready` unconditionally, so
behavior is additive and the slice ships independently.

## Behavior

When a `git: true` patch run reaches the completion transition — the point where
`tryFinishSpecIfDone` confirms zero unchecked boxes and a clean worktree, after
`spec complete` and before the shrink/review/`maybeMarkReady` phases — the
harness runs `bun run ready` once, harness-side (zero agent tokens), through the
existing `runReadyAndCommit` path.

- On green (`runReadyAndCommit` returns without throwing): the harness records a
  green result keyed to the resulting tree state — the post-`runReadyAndCommit`
  HEAD sha plus a clean worktree. (`runReadyAndCommit` may itself land a
  `check:fix` commit, moving HEAD; the recorded sha is the one after it
  returns.) This recorded result is held for the post-completion phases to
  consume in `01`.
- On red (`runReadyAndCommit` throws): the harness does not record a green
  result and falls through to the pre-existing post-completion behavior
  unchanged — shrink pre-gate, review baseline, and `maybeMarkReady` run exactly
  as they do today. This slice introduces no new red stop reason, no loop-back,
  and no change to the run exit code on red.

The completion transition is reached at most once per run, so `ready` runs at
most once here. When the run does not reach the completion transition with
`git: true` (loop-only `git: false`, no implementation iterations, an earlier
stop), no completion-transition `ready` runs and no green result is recorded.

Deferred to first consumer: the exact predicate a post-completion gate uses to
decide the tree is "unchanged since the recorded green result" — pin in `01`
when the gates consume the recorded result.

## Decisions

- Run the completion `ready` harness-side via the existing `runReadyAndCommit`
  path — rules out a second bespoke ready runner and rules out pushing `bun run
  ready` per-iteration onto the agent.
- Key the recorded green result on tree state (post-`runReadyAndCommit` HEAD sha
  + clean worktree), not a bare boolean — rules out a later phase reusing a
  stale green after a `shrink:` or `check:fix` commit mutates the tree.
- Red at the completion gate falls through to today's post-completion behavior
  unchanged — rules out coupling this slice to the red loop-back (a separate
  intent) so it lands alone.

## Tasks

- Run `bun run ready` once at the completion transition for `git: true` runs,
  via `runReadyAndCommit`, before the shrink/review/`maybeMarkReady` phases.
- On green, capture a recorded result keyed to the post-`runReadyAndCommit` HEAD
  sha and clean worktree, available to the post-completion phase entry.
- On red, preserve current post-completion behavior with no new stop reason or
  exit-code change.
- Cover green-capture and red-fallthrough with tests using the existing
  `runReadyAndCommit`/ready seams.

## Acceptance criteria

- [ ] A `git: true` patch run that reaches the completion transition runs `bun run ready` once at that transition, harness-side, before any post-completion phase.
- [ ] The completion-transition `ready` runs through the existing `runReadyAndCommit` path (no separate ready runner) and consumes zero agent tokens.
- [ ] On a green completion-transition `ready`, the harness records a green result keyed to the HEAD sha after `runReadyAndCommit` returns plus a clean worktree.
- [ ] When `runReadyAndCommit` lands a `check:fix` commit, the recorded green result is keyed to the post-commit HEAD sha, not the pre-gate sha.
- [ ] On a red completion-transition `ready`, no green result is recorded and the run proceeds into the existing post-completion phases (shrink, review, `maybeMarkReady`) with the same exit code and stop reasons as before this change.
- [ ] A run that does not reach the completion transition with `git: true` (loop-only `git: false`, zero implementation iterations, or an earlier stop) runs no completion-transition `ready` and records no green result.

## Documentation updates

- `v1/docs/run-loop.md`: in the Completion section, document the single
  completion-transition `ready` gate (harness-side, zero tokens, via
  `runReadyAndCommit`), the green result recorded keyed to HEAD sha + clean
  worktree, and that red falls through to the existing post-completion phases.
- `v2/docs/v1-behaviors.md`: add the completion-transition `ready` gate and the
  recorded green result (keyed to tree state) as a behavior, with sources.
