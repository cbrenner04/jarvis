## Verdict

Three upheld findings. All concern durable-state observability and resource-release correctness in the recovery path; none require reshaping the spec's design.

### 1. A `reopen_refused` settlement must be observable on the stage row

**Required outcome:** when a successful attempt is followed by a `reopenFailedPipeline` refusal, the target stage row must carry a `failureDetail` naming that refusal, the same way the `entry_run_missing` branch already settles a post-attempt failure.

**Why:** today that branch returns an outcome and writes nothing. On the RPC path the outcome is discarded entirely — the detached wrapper only catches throws, and the client already received `admitted`. The row keeps its *pre-recovery* `failureDetail`, so `v2/docs/daemon-host.md`'s claim that "the settled result is observable afterward on the stage row via `pipeline_list`" is false for exactly this case. It is also a terminal dead end: the corrected tree has already been landed and committed by the attempt, so `.jarvis-plan-stage` is no longer populated and any retry is refused by `recoverPlanStage`'s own populated-staging admission. An operator gets a stale reason and no signal that anything happened.

### 2. The `pipeline_recover` handler must not leak its claim, `activeRuns` entry, or log sink when admission throws

**Required outcome:** the worktree claim, the `recovery` `activeRuns` entry, and the log sink must be released on *every* exit from the handler, including an exception thrown out of the admission-and-recovery call before the wrapped attempt ever runs.

**Why:** those three are acquired unguarded before the `await`, and release currently happens only inside the wrapped attempt's `finally` or on a non-`admitted` return. A throw from resolution or the durable claim (e.g. a store error) skips both, leaking the `(project, branch)` worktree key for the daemon's lifetime — which then refuses every subsequent `start`, `resume`, and `recover` on that key. `resumeFinalizationOnly`, the precedent subspec `02` names, guards this. Low probability, unbounded and manual-only recovery.

### 3. A retiring daemon must not shut down between the attempt finishing and the stage row settling

**Required outcome:** the in-flight recovery must remain visible to `hasActiveRuns()` until the reopen, relink, `succeeded` write (or failure settlement) have completed — not merely until the attempt returns. Prefer extending the hold across the full detached chain; if that seam change is judged out of scope for this spec, then `v2/docs/daemon-host.md` must stop justifying the early release from "only the attempt touches the worktree" and must instead state plainly that the `activeRuns` entry is released before settlement and name the resulting window.

**Why:** `hasActiveRuns()` is what retirement shutdown consults. Releasing at attempt-completion opens a window in which a retiring daemon can exit after the corrected tree has been landed and committed but before the row is settled — leaving the row `failed` with empty staging, which recovery then permanently refuses. The stated rationale is sound for the *worktree claim* (only the attempt touches the worktree) but does not transfer to the `activeRuns` entry, which exists to keep shutdown from racing durable writes. Note the named precedent, `resumeFinalizationOnly`, holds its entry until settlement completes.

### Minor

- The retirement guard's `retiring === true` form diverges from the bare `if (retiring)` used by every sibling handler, purely to give a mutation directive a unique match string. Either make the guard naturally distinct or add a one-line comment saying why the form differs, so a future reader doesn't "normalize" it and silently break the checkpoint.
- The `const [, ...remainingSteps]` write-step drop is not redundant — it implements subspec `00`'s explicit "minus the leading write step" decision and fails safe on an off-shape resolution — but it reads as dead code next to the `behavior`-based review filter. A short comment stating that intent keeps it from being removed later.

### Not upheld

Resolution-time enforcement that a branch carries only one `failed` workflow row (the engine's failure cascade already maintains that invariant, and item 1's fix covers the observable consequence); the keystone mutation directive's placement on the awaited call rather than the handler (subspec `02`'s own ledger mandates driving that test with `detachContinuation: false`, so a handler-pinned directive could not turn it red); the coexistence of `recoverPipelineBranchStage` and `admitAndRecoverPipelineBranchStage` (both are specified, their return contracts differ substantively, and both funnel through the same settlement helper); `console.error` on the detached failure path (matches the sibling execution-layer modules, which carry no failure reporter by design).

Docs must be updated in step with any behavior change above, per the same subspec.