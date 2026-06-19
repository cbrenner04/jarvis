## Verdict

The spec's **decisions are sound — none need reversing.** It ships the mechanism off by default, reuses the existing kill path, and captures the right contract in its acceptance criteria. The valid gaps are under-specified *mechanism* in a subspec where structure is the contract (harness work, per spec guidance). Refine as follows.

### Required refinements

1. **Name the idle-abort routing branch and its placement (highest priority).** A spawn-layer abort settles as an error result whose reason matches none of the existing timeout/sigint branches. Left unhandled it falls through to the quota-fallback path, and because an idle agent made no iteration progress it lands on exactly the lenient "probable-quota-fallback" branch — emitting agent-error telemetry, triggering fallback, and never returning exit 8. This is the precise outcome the intent forbids. The spec must pin that the idle abort is detected by its distinct abort reason and handled **before** the quota-fallback path, so it is never classified as quota and never triggers agent fallback. The acceptance criteria assert this outcome; the task checklist must name the new branch and its ordering so the contract is explicit.

2. **Pin the idle-path telemetry field set.** The existing telemetry keys `exitReason` and the diagnostic fields off the wall-clock watchdog flag. The idle path needs its own flag/branch to emit `watchdog-idle-timeout`. Decide and state whether the idle path also populates the same descendant/pgid diagnostic fields as the wall-clock path (same diagnostic value argues yes). Without this the distinct `exitReason` is asserted but the surrounding field set is ambiguous.

3. **Pin shared kill-path reuse as an extracted helper.** The SIGTERM→grace→SIGKILL sequence and pre-abort descendant snapshot are currently inline in the wall-clock callback, not a reusable function. The decision "reuse the kill path / rules out a second mechanism" forbids divergence but doesn't choose how. State that both watchdogs invoke one shared helper so they cannot drift, rather than copying the block.

4. **Add a timing-tolerance note.** "Reset on output" is satisfiable by polling the shared last-output ref or a self-rescheduling timer (not impossible, no event hook required — reject that framing). But scheduling granularity means the abort can lag the configured span by up to one poll/scheduler tick. State this so the idle-abort test tolerates the lag rather than asserting an exact deadline.

5. **Cover or explicitly waive the loose edges:**
   - **pgid-null:** if idle fires before spawn completes, the explicit group kill is skipped but `controller.abort` + the spawn layer's own abort still kill the child. One line stating the idle path mirrors the wall-clock pgid-null guard settles it.
   - **idle ≥ wall-clock ordering:** the decision permits this and rests "harmless" on the `finally` clearing the idle timer when wall-clock wins. Add a one-line note that this case relies on `finally` cleanup and is untested (or add a cheap test).
   - **`[watchdog]` idle log line:** the checklist and docs promise it but no criterion grades it. Either add a light criterion verifying it or drop the promise — don't leave an ungraded deliverable.

### Rationale

Per spec guidance, harness subspecs may and should name hooks, telemetry fields, and internal symbols when structure is the contract. The intent's load-bearing constraint — idle abort returns exit 8, is never classified as quota, and never triggers fallback — hinges entirely on routing the new abort reason ahead of the quota-fallback path; leaving that unnamed risks an implementer reproducing exactly the misroute the intent exists to prevent (#1). The remaining items (#2–#5) close ambiguities that would otherwise let the two watchdogs diverge, leave telemetry under-specified, or ship ungraded/untested deliverables — all cheap to pin now and costly to discover in review.