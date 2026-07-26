---
name: completion-tail-joins-the-shared-publication-tail
---

# The live-step completion tail publishes through the same shared tail

## Problem

The primary `executeWorkflow` completion tail still owns its own copy of commit-first, body-summary
derivation, `specTemplate` selection, publication-failure settlement, and work-boundary recording,
because it is driven by live `AnyWorkflowStep` objects rather than a persisted snapshot. As long as
it stays separate, a behavior fixed on the resume paths does not reach the path every run takes.

## Behavior

`publishWithReadyRepair` has exactly one calling tail: the primary completion tail resolves its
context from live steps and hands it to the same shared tail the snapshot-backed resumes use, and a
test fails if a second call site is reintroduced.

## Decisions

- The live tail adapts to the shared context type (worktree, base ref, spec path, landing kind,
  completion agent, creation title); no `AnyWorkflowStep` crosses the seam. Rules out passing steps
  into the shared tail to reuse code.
- Live-only concerns — `setRunStatus`-based settlement, `emitWorkBoundaryRecorded`, the shrink
  narrative, `WorkflowOutcome` construction — become explicit parameters or stay at the call site
  above the seam. Rules out folding live-step settlement into the resume paths.
- Enforce single-tail with a test guard on the call-site count. Rules out a fourth parallel tail when
  the next resume path lands.
- Out of scope: whether resume should exist for these outcomes; the admission predicates.

## Acceptance criteria

- [ ] `publishWithReadyRepair` has one calling tail; a test fails if a second call site is added.
- [ ] Existing primary-completion-tail coverage in `v2/src/execution/workflow-runner.test.ts`,
      `resumes intent finalization from a populated stage without review re-invocation`, and
      `resuming a review row's surviving_mutation_failed actually re-runs the ready finalizer` pass
      with no assertion weakened.
- [ ] A test proves one change in the shared tail is observable on the primary completion path and
      both resume paths, and fails if only one path has it.

## Documentation updates

- `v2/docs/workflow-runner.md` — one publication tail, its inputs, and how both live steps and
  snapshot-backed resume reach it.

## Prerequisites

- Both snapshot-backed resume paths publish through one shared publication tail taking a resolved context.
- Each publication tail's per-path differences are asserted by tests and named as intentional or accidental in `v2/docs/workflow-runner.md`.
