## Verdict

**Five issues must be fixed before merge.**

---

### 1. Kill/crash resume: `attemptId` identity is untested

The AC for kill/crash resume requires that the re-invocation emits `iteration_started` with the *same* `attemptId` as the original interrupted attempt. The current test emits `iteration_started` in the resumed run but never captures the first run's `attemptId` and never compares across invocations. The `getEventsForRun("")` call at line 708 is dead code (result stored in an underscore-prefixed variable, never read, with a comment acknowledging incompleteness). The invariant — same `attemptId` on resume — is the load-bearing assertion for this scenario and must be directly verified.

**Required:** The test must capture the `attemptId` from the first run's `iteration_started` event and assert that the resumed run's `iteration_started` carries the identical value.

---

### 2. Mid-boundary rollback: `attemptId` identity is untested

The AC requires that the retry after a mid-boundary failure reuses the same `attemptId` as the initial attempt. The test uses separate sink instances and checks only event *kinds*. The `attemptId` from the failed attempt is never captured, so sameness across the two `iteration_started` events is unverified.

**Required:** The test must compare `attemptId` between the first `iteration_started` (failed attempt) and the second `iteration_started` (retry), asserting they are equal.

---

### 3. `follow` tests are flaky due to wall-clock timing

Two tests race wall-clock delays against the 100ms poll interval:
- The 200ms pre-append delay in one test assumes the follower has already yielded existing events, which is not guaranteed under load.
- The 100ms abort delay races the 100ms poll sleep, making `events.length >= 1` non-deterministic.

**Required:** Replace `setTimeout`-based synchronization with event-driven coordination (e.g., wait until the accumulated event count reaches the expected threshold before proceeding). A hang-guard `AbortController` with a deadline should protect any loop that waits for an unbounded event count.

---

### 4. `follow` AC #3 test has no hang-guard

The test loops until `events.length >= 4` with no deadline. If events never arrive due to a bug, the test hangs until the global runner timeout, masking the failure.

**Required:** The accumulation loop must have a deadline abort controller so a missing event produces a test failure, not a hang.

---

### 5. `loop_finished.iterationsConsumed` is not verified inside the event payload

`iterationsConsumed` is a specified field on `LoopFinishedEvent`. The multi-iteration and soft-stop tests assert it on the function's return value but not on the emitted `loop_finished` event. The spec's AC requires emission coverage; a mismatch between the returned value and the emitted payload would be undetected.

**Required:** The relevant tests must assert `loop_finished.iterationsConsumed` on the event read back from the sink, not only on the function return value.