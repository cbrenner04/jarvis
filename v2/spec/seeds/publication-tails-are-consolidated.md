---
name: publication-tails-are-consolidated
---

# The three publication tails are pinned, then consolidated

**Deferred.** No current correctness incident. Collapsed 2026-07-26 from three ready-intents
(`publication-tail-differences-are-pinned-and-documented`,
`snapshot-resumes-share-one-publication-tail`, `completion-tail-joins-the-shared-publication-tail`)
into one seed: they were a single characterization-then-refactor sequence on an internal seam,
competing for implement slots against work-loss and wrong-execution defects. Promote only when a
real publication divergence bites.

## Problem

`publishWithReadyRepair` (`v2/src/execution/workflow-runner.ts`) has three surrounding tails: the
primary `executeWorkflow` completion tail, `resumePopulatedIntentPublication`, and
`resumeReviewMutationFinalization`. They diverge on commit-before-publish handling, body-summary
derivation, `specTemplate`, settlement (`setRunStatus` vs `commitCompletionBoundary`), attempt/work
boundary recording, and which outcomes are settled `resumable`. Nothing records which difference is
intentional, so consolidation today would refactor against assumed equivalence. Observed cost: each
resume path has separately had to relearn not to settle a row `resumable: true` that `run resume`
refuses, and uncommitted-path detection already differs between the two resumes.

## Shape when promoted

Three ordered slices, in this order — the pin is what makes the rest safe:

1. **Pin.** Tests assert each tail's shipped behavior on those axes and fail if it changes;
   `v2/docs/workflow-runner.md` names each difference and whether it is intentional.
2. **Merge the resumes.** One shared tail takes a resolved context both snapshot-backed resumes
   produce.
3. **Merge the completion tail.** The primary tail resolves its context from live
   `AnyWorkflowStep` objects and hands it to that same shared tail; a test fails if a second
   `publishWithReadyRepair` call site is reintroduced.

Do not start at slice 2 or 3 — an unpinned merge silently picks one tail's behavior for all three.
