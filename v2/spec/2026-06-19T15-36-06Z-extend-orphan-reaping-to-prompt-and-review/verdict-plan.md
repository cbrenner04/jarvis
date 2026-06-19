# Verdict — Refinements Required

The core design (per-invocation `DescendantTracker`, poll-on-spawn + interval, reap in `finally`, best-effort/non-fatal) is sound and faithful to the patch-loop precedent. Ship it after addressing the following. Findings on terminology and the missing structural criterion are rejected (see end).

## Required refinements

1. **Pin the review-mode test-override home and the signature change it forces.**
   Subspec 01 says only "expose a test-only reap override" without naming where it lives or what it costs. The two review spawn sites (the reviewer pass wrapped by `withReviewPassTimeout`, and the verdict actuator) are constructed on different paths but both can reach the phase-options object in lexical scope. The spec must name the override's home on that shared options object and state explicitly that `withReviewPassTimeout` currently takes no options object, so its signature grows to receive the override and per-invocation tracker. This is real, currently-unstated work; leaving it implicit understates the change and risks an inconsistent implementation across the two sites.

2. **State how the two acceptance criteria are discharged.**
   Each subspec's first criterion ("SIGKILLs a real re-parented orphan when the invocation ends") cannot be verified through the injected reap override, because injecting the override replaces the real reap. The spec must make the verification story explicit: real-kill behavior is already covered by the existing `DescendantTracker` unit tests, and the new per-mode tests assert only that (a) polling is wired on spawn + interval and (b) reap is invoked in `finally` and is non-fatal. As written, the integration-flavored criterion reads as un-runnable against the seam being introduced.

3. **Resolve the shared-constant location and surface the resulting cross-file edits.**
   The poll-interval value (`500`) currently lives as a private constant in `patch/run.ts`, not in `reap.ts`. Sharing one cadence across modes means relocating it and re-pointing the patch loop's import — an edit to `patch/run.ts`, which is outside the intent's declared scope (`prompt/run.ts`, `review.ts`, tests, docs). The spec must pick the shared home (exporting from `reap.ts`, already in the reused dependency surface, keeps the patch-side change to a one-line re-point) and explicitly acknowledge the `patch/run.ts` edit so the scope expansion is deliberate, not a silent leak.

4. **Order the subspecs.** Subspec 01 consumes the shared constant introduced by 00, so 01 is not independent of 00. `index.md` (or 01's text) must note this ordering; otherwise the "independently testable" claim is false.

5. **Make the prompt per-attempt `try/finally` explicit and cover all exit branches.**
   Subspec 00 says "reap in the attempt's `finally`," but the prompt-mode attempt body has no per-attempt `try/finally` today — only an outer `finally` that releases the lock and writes telemetry. The implementer must introduce a new per-attempt `try/finally` inside the fallback loop covering every exit path (quota continue, success break, watchdog-timeout break, model-config continue, error break), with the interval-clear and reap sitting inside the loop and not conflated with the outer finally. The spec should state that all branches are covered, and call out the watchdog-timeout path specifically — it follows a process-group kill that scatters escapees and is the highest-value reap target, yet no criterion currently names it.

## Worth a sentence each (cheap, preempts reader questions)

6. **Review/patch tracker non-overlap.** Review runs as a separate phase after the patch iteration's `finally` has already cleared its handle and reaped, so the patch tracker is idle during review; per-invocation review trackers do not overlap it (and reap is per-PID and identity-guarded, so overlap would be benign anyway). One clarifying sentence in 01.

7. **Actuator pgid already captured.** The actuator path already captures its process-group id (currently unused); the tracker work converts that latent capture into a poll root rather than adding capture from scratch. Noting this in 01 reduces implementer surprise.

## Rejected (no spec change)

- **Terminology.** The intent calls this "marker-based" reaping, but the actual mechanism is marker-free descendant-PID tracking. The spec already says "marker-free `DescendantTracker`" and correctly diverges from the intent's wording; this is the right call. No change beyond not regressing to "marker" language.
- **No criterion for the single-sourced constant.** Per spec guidance, acceptance criteria describe observable behavior, not structure. A "constant is single-sourced" check would be a structural criterion the guidance discourages for this kind of work. Leaving the de-dup as a decision without a criterion is correct.