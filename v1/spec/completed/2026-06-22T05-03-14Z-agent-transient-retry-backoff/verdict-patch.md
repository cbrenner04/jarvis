## Verdict — refinements required

The core mechanism (escalating `[1s,2s,4s]` backoff, cap 3 → 4 spawns, `onTransientRetry` before sleep with `cap: 3`, the rewritten `spawn.sandbox-unrunnable.test.ts` contract, untouched classification/ordering, doc updates) is correctly implemented and well-covered. The defects all cluster on one surface: the abort-during-sleep path and its sleep seam are never executed by any test. Address the following before merge.

### Required outcomes

1. **The abort-during-sleep guarantee must be exercised, not just claimed.** Acceptance criterion #4 is checked `[x]` asserting that "an abort arriving *during* a backoff sleep returns immediately (the sleep races the signal)." No test drives this: every transient test injects a no-op/recorder sleep, so the real sleep's race logic never runs, and the one abort test aborts on the first spawn before any sleep is scheduled. This is the same false-green pattern the plan verdict flagged — a load-bearing decision marked satisfied with nothing executing it. **Outcome:** a test must drive a genuine transient retry into a backoff sleep, abort mid-sleep, and assert prompt return — exercising the real race path, not only the injected seam. If for some reason the race cannot be made true, the AC must be corrected to state the actual behavior rather than left as a false claim.

2. **The default sleep seam must not leak abort listeners.** The default sleep registers an `abort` listener on `opts.signal` but never removes it on the normal timeout path. `opts.signal` is the long-lived run/iteration signal reused across up to three sleeps per `runAgent` and persisting beyond it, so listeners accumulate (risking `MaxListenersExceededWarning`) and a later abort fires stale callbacks. **Outcome:** the sleep seam must clean up after itself on both paths (timeout and abort) so no listener survives a settled sleep. This slipped precisely because outcome #1's gap means the function is never run; the test added there should make the leak observable or be structured so it would catch it.

3. **Abort during a sleep must not launch a doomed extra spawn.** After the sleep resolves on abort, the loop currently re-enters `singleSpawn` — spawning and immediately killing a real subprocess — before the retry check short-circuits. Latency is fine, but the "abort wins immediately" intent is undercut by wasted work. **Outcome:** an abort observed coming out of a backoff sleep must short-circuit before any further spawn.

4. **Fix the AC #2 wording overstatement.** AC #2 says "all inject the seam," but the aborted-invocation test does not; it merely avoids wall-clocking incidentally. **Outcome:** the wording must match reality (e.g., the transient tests that take a backoff inject the seam). This resolves naturally alongside outcome #1.

### Not required (noted)

Deriving `TRANSIENT_RETRY_CAP` from the schedule length to keep the cap-and-schedule invariant self-maintaining is a reasonable defensive cleanup but is not blocking — today the cap equals the schedule length and the non-null assertion is sound. Optional.

### Rationale

Outcomes 1–4 share one root cause: the abort-race code and its sleep seam are dead with respect to the test suite, so a checked acceptance criterion, a resource leak, and a wasted-spawn regression all went uncaught. The spec elevated abort-during-sleep to an explicit load-bearing decision; the repo principle is that a green AC must be backed by a test that locates and drives the behavior, not asserted by inspection. Fixing the test surface closes all four.