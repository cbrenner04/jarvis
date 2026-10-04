## Verdict — required outcomes

**1. Inversion control must not be a mutable module-level global on the production path.**
The precedence-inversion switch currently lives as process-wide mutable state in `write-loop.ts` and is toggled via an exported setter, with correctness depending on a `finally` reset. Unlike display-only test seams, this one changes durable run outcome (`iteration_timeout` vs `progress`). Required outcome: the inversion is carried per-call — an optional field on `WriteLoopInput` alongside `schedule` — so no test can leave a stale global that alters another run's settlement, and the production module holds no mutable test state. The guard's proof value (inverted precedence flips the watchdog-first case to `progress`) must be preserved. Any type used in an exported signature must itself be exported.

**2. The seam's cancel/reschedule path must be exercised through the injected seam.**
The subspec decision requires the seam cover "every wall-segment schedule and cancel/reschedule on progress via `bumpWallSegment`, not only the initial schedule." Wiring is correct, but no test observes it: the preservation cases cover bump only through real timers. Required outcome: a test drives progress output with an injected schedule and asserts the prior handle was cancelled and a new schedule registered — so a regression that stops cancelling on bump (handle leak per output chunk) fails a test rather than passing everything.

**3. The manual schedule helper must be correct under repeated registration.**
It keeps one `pendingFire` slot, a `cancel` closure not scoped to the handle it belongs to, a latching `registered` flag, and one waiter slot. This is benign only because current call sites register exactly once; it becomes wrong the moment outcome 2 exists. Required outcome: the helper tracks registrations and cancels per handle (or its single-registration assumption is explicit and outcome 2 uses a helper that doesn't have it).

**4. The inversion test's comment must state what it actually proves.**
It asserts that the *settlement-kind mapping* is load-bearing, not that race ordering is. Genuine ordering regressions (dropping the `watchdogSettled` latch, making abort settle synchronously, reordering `Promise.race` operands) remain invisible to it. This satisfies AC3 as written ("or the `timed_out` vs `aborted` settlement branch"), so no redesign is required — but the comment must not overclaim ordering coverage.

**5. The 50× loop must be diagnosable on failure.**
A failure at iteration 37 of the early or late subcase currently reports an anonymous object mismatch. Required outcome: assertions carry the iteration index and subcase label.

**6. The double microtask flush must explain itself.**
`await Promise.resolve()` twice is tuned to today's single `queueMicrotask` hop in abort settlement and silently under-flushes if that changes. Required outcome: either a one-line note tying the flush to abort settlement, or a barrier on abort settlement actually being observable before `fire()`.

**Optional:** the four-cell truth-table test over the one-line precedence predicate asserts only the test hook and is redundant with the end-to-end inversion case; dropping it is fine.

**Not required — explicitly rejected:**
- The inversion switch reaching the ceiling timer's fire path. The seam correctly excludes `iterationCeilingMs` per spec; the case's non-goal scopes what the *test asserts*, not what production code may touch. No test configures a ceiling with inversion on.
- Trimming the 50 in-test iterations. AC2 mandates them verbatim; changing that is a spec decision, not the actuator's.
- Restoring near-simultaneous abort/watchdog contention coverage. The spec deliberately traded contention for injected control ("not competing real timers") because contention is what flaked; the late subcase still discriminates real loop logic downstream of settlement.

Constraints: do not modify spec files or checkbox state; no doc updates (spec says none). `bun run typecheck`, `test:v2`, and `test:integration:v2` must stay green, and the existing wall-reset and hard-ceiling cases must stay green.