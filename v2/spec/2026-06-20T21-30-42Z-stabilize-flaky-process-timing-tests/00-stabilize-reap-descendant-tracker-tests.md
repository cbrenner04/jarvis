# Stabilize reap DescendantTracker tests

## Problem

In `v1/test/modes/patch/reap.test.ts`, two `DescendantTracker` tests spawn real `perl` processes and assert on process lifecycle via the local `waitFor` poll (3000ms deadline, 25ms tick):

- "reaps a descendant that escaped its group and re-parented to init"
- "does not target a tracked PID that has already exited (reuse guard)"

Under `bun test --parallel` on a loaded machine, CPU contention slows process spawn, the `setsid`/re-parent transition, and kill propagation; the bounded `waitFor` polls (grandchild alive, `ppid === 1`, target dead) intermittently miss their deadline and the test reads red. They pass in isolation. The reaping code (`v1/src/modes/patch/reap.ts`) is correct and must not change.

## Decisions

- Test-only changes confined to `reap.test.ts` (and any new test-only helper it imports). Rules out touching `reap.ts`. — the implementation under test is correct.
- Preserve each assertion's intent: descendant captured before kill, orphan re-parents to init, reaper kills it by recorded identity, exited-PID reuse guard prunes without a bogus kill. Rules out deleting or weakening these checks.
- Done is structural determinism, not statistical repeatability: the stabilized assertions stop reading scheduler/wall-clock timing as a pass/fail axis (poll-until-a-condition with a generous deadline, or serialization). A single green run plus that structural argument is the completion signal — a one-shot gate cannot prove a flake gone by passing once. Rules out defining done as "passed N times under load."
- The mechanism must not mask a correctness regression: a genuinely broken implementation must still fail. Prefer poll-until-bounded-deadline (which fails a broken impl) over a retry-on-timing wrapper (which can hide a regression that manifests as a timing failure — a coverage cost distinct from deleting a check).
- Diagnose the timing dependency by inspection (fixed-time `waitFor` deadlines) and pick the mechanism from that; reproduce the flake opportunistically if it surfaces, but do not block on a red run that may never appear. Candidate mechanisms (intent-sanctioned, in preference order): poll-until-with-bounded-deadline / relative assertions; serialize just these process-spawning tests outside the parallel pool (fallback — only if per-test opt-out is supported by the runner); a retry-on-timing wrapper scoped to these two tests (last resort, see masking constraint). Rules out widening the global suite timeout or dropping `--parallel`.

## Task checklist

- [ ] Diagnose the fixed-time `waitFor` dependency in the two tests by inspection; confirm green in isolation (reproduce the flake only opportunistically).
- [ ] Apply the per-test structural stabilization mechanism to `reap.test.ts` only.
- [ ] Confirm the two tests pass in isolation and inside the full `bun run test` run.

## Acceptance criteria

- [ ] The two named `DescendantTracker` tests in `v1/test/modes/patch/reap.test.ts` pass in isolation and inside the full `bun run test` run, and no longer read scheduler/wall-clock timing as a pass/fail axis (structurally deterministic, not statistically de-flaked).
- [ ] Their assertion intent is preserved: pre-kill descendant capture, re-parent-to-init detection, identity-based reap, and the exited-PID reuse guard each still verify the same behavior (no deleted or weakened checks); the mechanism still fails a genuinely broken reaping implementation.
- [ ] No change to `v1/src/modes/patch/reap.ts`; changes are confined to `reap.test.ts` and any test-only helper it imports.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md`: only if the chosen mechanism introduces a shared serial/helper convention that changes an observable testing contract (likely none — a per-test poll change introduces none).
