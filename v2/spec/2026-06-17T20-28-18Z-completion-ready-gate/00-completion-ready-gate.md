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
is `01`); after this subspec alone they still run `ready` unconditionally. So
`00` landed alone *adds* a `ready` run on the green common path — the completion
gate plus the still-unchanged shrink/review gates — temporarily raising the
wall-clock the intent targets, and the recorded result is dead state until `01`
consumes it. The slice is still green and outcome-preserving (it changes no exit
code or stop reason); the wall-clock reduction is realized only once `00` and
`01` land together, which is the expectation.

## Behavior

When a `git: true` patch run reaches the completion transition — the point in
`tryFinishSpecIfDone` where it confirms zero unchecked boxes and a clean
worktree, after `spec complete` and before the shrink/review/`maybeMarkReady`
phases — the harness runs `bun run ready` once, harness-side (zero agent
tokens), through the existing `runReadyAndCommit` path.

- On green (`runReadyAndCommit` returns without throwing): the harness records a
  green result keyed to the resulting tree state — the post-`runReadyAndCommit`
  HEAD sha plus a clean worktree. `runReadyAndCommit` returns no value and may
  itself land a `check:fix` commit (moving HEAD); the recorded sha is read by a
  separate `git rev-parse HEAD` *after* it returns, so it is the post-commit sha.
  This recorded result is held for the post-completion phases to consume in `01`.
- On red (`runReadyAndCommit` throws): the harness does not record a green
  result and falls through to the pre-existing post-completion behavior
  unchanged — shrink pre-gate, review baseline, and `maybeMarkReady` run exactly
  as they do today. This slice introduces no new red stop reason, no loop-back,
  and no change to the run exit code on red.

The new gate lives inside `tryFinishSpecIfDone`, which early-returns whenever
unchecked boxes remain, so the completion transition is reached at most once per
run and `ready` runs at most once here. This is distinct from the per-iteration
early-ready `maybeMarkReady` call in the iteration loop, which fires *before*
the completion transition on the path where neither shrink nor review will run;
that per-iteration site is out of scope for `00` (it is addressed in `01`). When
the run does not reach the completion transition with `git: true` (loop-only
`git: false`, no implementation iterations, an earlier stop), no
completion-transition `ready` runs and no green result is recorded.

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

- In `tryFinishSpecIfDone`, run `bun run ready` once at the completion
  transition for `git: true` runs, via `runReadyAndCommit`, after `spec
  complete` and before the shrink/review/`maybeMarkReady` phases.
- On green, read HEAD with a separate `git rev-parse HEAD` after
  `runReadyAndCommit` returns and capture a recorded result keyed to that
  post-commit sha and clean worktree, available to the post-completion phase
  entry. Leave the per-iteration early-ready `maybeMarkReady` site untouched in
  `00` (it is in scope for `01`).
- On red, preserve current post-completion behavior with no new stop reason or
  exit-code change.
- Cover green-capture and red-fallthrough with tests using the existing
  `runReadyAndCommit`/ready seams.

## Acceptance criteria

- [x] A `git: true` patch run that reaches the completion transition runs `bun run ready` once at that transition, harness-side, before any post-completion phase.
- [x] The completion-transition `ready` runs through the existing `runReadyAndCommit` path (no separate ready runner) and consumes zero agent tokens.
- [x] On a green completion-transition `ready`, the harness records a green result keyed to the HEAD sha after `runReadyAndCommit` returns plus a clean worktree.
- [x] When `runReadyAndCommit` lands a `check:fix` commit, the recorded green result is keyed to the post-commit HEAD sha, not the pre-gate sha.
- [x] On a red completion-transition `ready`, no green result is recorded and the run proceeds into the existing post-completion phases (shrink, review, `maybeMarkReady`) with the same exit code and stop reasons as before this change.
- [x] A run that does not reach the completion transition with `git: true` (loop-only `git: false`, zero implementation iterations, or an earlier stop) runs no completion-transition `ready` and records no green result.

## Documentation updates

Doc partition with `01`: `00` *adds* the new completion-gate behavior only; it
does not touch the existing shrink/review gate descriptions (those are edited in
`01` to record reuse). This keeps each behavior in one durable home with no
overlapping edits.

- `v1/docs/run-loop.md`: in the Completion section, document the single
  completion-transition `ready` gate (harness-side, zero tokens, via
  `runReadyAndCommit`), the green result recorded keyed to HEAD sha + clean
  worktree (the sha read after `runReadyAndCommit` returns, post-`check:fix`),
  and that red falls through to the existing post-completion phases unchanged.
- `v2/docs/v1-behaviors.md`: add the completion-transition `ready` gate and the
  recorded green result (keyed to tree state) as a new behavior entry, with
  sources (`v1/src/modes/patch/run.ts`, `v1/src/ready-gate.ts`,
  `v1/docs/run-loop.md`).
