## Verdict: required spec refinements

1. **Early-ordering harness vs production settlement**  
   The subspec must state how the “abort before watchdog” subcase wins `Promise.race` when production resolves abort on a microtask and the watchdog on synchronous `fire()`. “Drive `fire` and `abort()` in asserted order” is not enough if both run in one synchronous turn. Required outcome: acceptance criteria or decisions that the early path establishes abort **before** a synchronous watchdog fire in terms the race actually uses (e.g. abort, then microtask/settlement flush, then `fire()`; or `fire()` only after abort has settled)—without widening to a full fake clock.

2. **Barrier before driving the schedule**  
   Required outcome: the rewritten case must not use wall-clock waits to sync with the loop; it must wait until the injected `schedule` has registered `fire` (promise, barrier, or equivalent) before calling `fire()` or `abort()`.

3. **Minimal seam contract on `WriteLoopInput`**  
   Decisions should spell out, at outcome level: production default for the seam is current `setTimeout` behavior; the seam covers wall-segment scheduling in `awaitIteration` including **cancel/reschedule** when progress bumps the wall (`bumpWallSegment`), not only the initial schedule. Intent’s “narrow seam, not repo-wide clock” stays; `iterationCeilingMs` may remain on real timers until a later consumer.

4. **Explicit non-goals for this test case**  
   Clarify that this case does not set or assert `iterationCeilingMs` or ceiling-vs-abort ordering, so “no real-clock races in this test” is not read as “no real timers anywhere in the write loop.”

5. **Inversion guard (spec guidance)**  
   Sharpen AC3 and the task checklist: name the rewritten case (or a dedicated guard) as the inversion target; require a **committed, CI-runnable** inversion check (comment/skip pattern or sibling guard style) where inverting abort-vs-watchdog precedence fails at least one test, with the **late-ordering** path proving wrong `iteration_timeout` when precedence is wrong. Add a checklist item for that guard.

6. **Preservation AC for refactor/seam work (spec guidance)**  
   Add an acceptance criterion that cites existing `write-loop.test.ts` cases for iteration wall reset and ceiling timeout (by name or stable description) as staying green, so a broken default `schedule` or `bumpWallSegment` wiring cannot pass on the rewritten case and 50× loop alone.

7. **Verification scope alignment (minor)**  
   Align the “tests pass” AC with repo CI scope for `v2/**` changes: `bun run test:v2` **and** `bun run test:integration:v2` (or an explicit, justified exception). Rationale: matches `AGENTS.md` / `ci-test-scope.ts`; low risk but avoids a narrow gate.

**Not required (no change):** Expanding intent to repeat `WriteLoopInput` API wording; switching 50× to process-level repetition; duplicating guard-sibling docs; mandating `(Manual)` on “fails against pre-fix” unless the team wants tick semantics clarified—the durable guards are the deterministic rewrite, 50× loop, and inversion guard; pre-fix language can stay as design narrative if unchanged.

**Rationale summary:** The intent (injected control, both orderings, no margin widening, defer full clock) is sound. Remaining gaps are implementer-facing: same-turn microtask vs synchronous timeout can make a “deterministic” test lie about the bug being fixed; an underspecified seam can regress bump/cancel while the target case passes; inversion and preservation ACs need named anchors per harness spec guidance. Refinements stay outcome-focused and do not require a repo-wide fake clock or new product behavior.