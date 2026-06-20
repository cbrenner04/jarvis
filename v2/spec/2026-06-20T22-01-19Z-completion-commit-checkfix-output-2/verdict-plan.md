## Verdict — Required Refinements

The spec's additive framing, ordering (increment after `isStuckRed` fails), exit-10 reuse, and v1-behaviors inclusion are sound and should stand. The following must be refined before the spec is ready. The core problem: the spec treats the gate-side counter as if it can observe AC progress and reuse the existing stuck-red message, when in fact it sees neither.

**1. Name the AC-progress reset seam.**
The completion ready gate only runs when zero acceptance criteria are unchecked — so at the gate, every AC is already checked and nothing is ever "newly checked" there. The spec's reset trigger "a newly-checked AC" therefore has no seam at the gate as written. The only path that re-ticks a box between two red gates is regression-then-recovery in the *regular* iteration path, which already computes newly-checked AC state. The spec must name where AC progress is detected and how it is carried to the gate (e.g. a piece of iteration state set on the regular path and consumed/reset by the gate), rather than implying the gate can see AC progress directly. Without naming this seam the "reset on genuine progress" decision is unimplementable as specified.

**2. Split AC #3 and supply a test vector for the AC-progress reset.**
AC #3 bundles two resets with different test paths. The green-gate reset is exercisable through the `runCompletionReadyGate` seam (red, red, green, red restarts the count). The AC-progress reset is not reachable through that seam — it requires driving the spec from incomplete to complete mid-loop and asserting the state flag clears. Split the criterion so each reset has its own demonstrable test path, and state the vector for the AC-progress case; otherwise that half asserts behavior with no shown way to verify it.

**3. Commit to a correct changing-failure message and guard it with an AC.**
The reused exit-10 message asserts the failure is *unchanged* after fix-up — which is false for the changing-failure trigger, whose premise is that the failure differs each pass. Because the Documentation updates rewrite the exit-10 prose, the operator-facing message is part of this subspec's contract; a wrong "unchanged" line actively misdirects triage. The spec must resolve the open "pin during implementation" and commit to distinguishing the changing-failure message from the identical-failure one, with an acceptance criterion asserting the emitted message matches the trigger.

**4. Add a worked count trace and pin `N < maxIterations`.**
The off-by-one (first red gate counts; `N ≥ 2` allows exactly one genuine fix-up before the bound) is the entire contract and should be shown by a one-line trace, not left to inference. AC #1's bound-vs-exit-5 assertion is vacuous unless N is strictly less than `maxIterations`; state that constraint so the test demonstrably stops at the bound rather than the loop ceiling.

**5. Correct the stale doc source-pointer.**
The v1-behaviors.md section this subspec edits still attributes the stuck-red logic to `run.ts`; the logic lives in `completion-pipeline.ts`. Since the subspec rewrites that section, correct the pointer in-scope.

## Not required (over-reach — accept as conscious tradeoffs)

- **False-positive on slow-but-genuine convergence.** A no-progress bound on a changing failure cannot distinguish thrashing from converging one real failure per pass with the spec already complete. This is the intended tradeoff and exit 10 is recoverable (operator reruns to resume). At most a one-sentence note making the tradeoff and recoverability explicit; not a design hole.
- **Telemetry collapses the two triggers under one reason/exit.** The intent deliberately reuses exit 10 and rules out a new operator-visible code because both are the same recoverable "stuck red, intervene" outcome. A distinguishing sub-field is optional; if refinement #3 yields a branched message it becomes near-free, worth a one-line conscious-omission note but not a blocker.