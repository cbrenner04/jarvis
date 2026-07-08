## Verdict

**Upheld — must fix:**

1. **Shrink runs must be daemon-trackable.** The shrink write-loop invocation is dispatched without the run-registration callback (`onStepRunCreated`/`onRunCreated`) that the main step-execution path always passes through. Without it, a shrink pass in progress is invisible to daemon pause/cancel/liveness RPCs — an operator has no way to observe or control a shrink run while it executes. Fix: thread the run-registration callback into the shrink invocation the same way the main step path does, so shrink runs are trackable like any other write-loop invocation.

2. **Non-`complete` shrink outcomes must report the shrink run's own `runId`.** AC5 requires that a non-`complete` shrink outcome replace the implement step's outcome kind and halt the workflow. The reported `runId` on that failure path must be the shrink invocation's `runId`, not the already-completed implement step's stale `runId` — otherwise an operator hitting a paused/blocked/failed shrink pass has no way to resume or inspect the actual failing run. Fix: on the non-complete branch, surface the shrink result's own `runId`.

**Worth a documentation note, not a functional fix:**

3. The shrink trigger keys on the write step's `role` being `"implement"`, not on "is this the shipped implement preset." This is consistent with the spec's stated design (trigger from the runner's post-complete boundary, not a preset-specific check), so it's not a defect. But it means any hand-authored workflow step that happens to use `role: "implement"` for a different purpose would also trigger the hidden shrink pass. Add a one-line callout in `v2/docs/workflow-runner.md` noting that the shrink hook fires for any write step named `role: "implement"`, not only the shipped preset — so this isn't discovered as a surprise later.

No other changes required.