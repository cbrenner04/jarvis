---
name: snapshot-resumes-share-one-publication-tail
---

# Both snapshot-backed resumes publish through one shared tail

## Problem

`resumePopulatedIntentPublication` and `resumeReviewMutationFinalization` each reimplement the same
tail from a persisted snapshot: commit the durable dir, detect uncommitted leftovers, derive the PR
body summary, call `publishWithReadyRepair`, settle the attempt boundary, and log `loop_finished`.
They already diverge (uncommitted-path detection includes remaining staged intent paths in one and
not the other; `specTemplate` is passed by one only), and each has separately had to relearn not to
settle a row `resumable: true` that `run resume` refuses.

## Behavior

One publication tail, taking a resolved context both resume paths produce, drives both resumes;
their intentional differences are explicit arguments with named defaults.

## Decisions

- The seam is the resolved context (worktree, base ref, spec path, landing kind, completion agent,
  creation title, invocation id), not the caller. Rules out threading resume-specific context objects
  through a shared function via type unions.
- Per-path differences pinned as intentional become named parameters with defaults; accidental ones
  converge on the documented-correct behavior. Rules out a silent behavior swap disguised as cleanup.
- Settlement stays `commitCompletionBoundary`-based for both resumes. Rules out generalizing the
  settlement mechanism before the live-step caller arrives.
- Out of scope: the primary `executeWorkflow` completion tail; resume admission predicates.

## Acceptance criteria

- [ ] Both resume paths call one shared publication tail; neither retains its own
      `publishWithReadyRepair` call site.
- [ ] Every intentional difference between the two is an explicit argument with a named default,
      readable at the call sites without diffing bodies.
- [ ] `resumes intent finalization from a populated stage without review re-invocation` and
      `resuming a review row's surviving_mutation_failed actually re-runs the ready finalizer` pass
      with no assertion weakened.
- [ ] A test proves a single change in the shared tail (e.g. commit-before-publish) is observable on
      both resume paths.

## Documentation updates

- `v2/docs/workflow-runner.md` — the shared snapshot-backed publication tail, its inputs, and how
  each resume reaches it.

## Prerequisites

- Each publication tail's per-path differences are asserted by tests and named as intentional or accidental in `v2/docs/workflow-runner.md`.
