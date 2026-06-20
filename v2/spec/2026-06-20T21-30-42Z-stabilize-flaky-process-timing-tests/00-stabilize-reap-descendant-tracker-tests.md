# Stabilize reap DescendantTracker tests

## Problem

In `v1/test/modes/patch/reap.test.ts`, two `DescendantTracker` tests spawn real `perl` processes and assert on process lifecycle via the local `waitFor` poll (3000ms deadline, 25ms tick):

- "reaps a descendant that escaped its group and re-parented to init"
- "does not target a tracked PID that has already exited (reuse guard)"

Under `bun test --parallel` on a loaded machine, CPU contention slows process spawn, the `setsid`/re-parent transition, and kill propagation; the bounded `waitFor` polls (grandchild alive, `ppid === 1`, target dead) intermittently miss their deadline and the test reads red. They pass in isolation. The reaping code (`v1/src/modes/patch/reap.ts`) is correct and must not change.

## Decisions

- Test-only changes confined to `reap.test.ts` (and any new test-only helper it imports). Rules out touching `reap.ts`. — the implementation under test is correct.
- Preserve each assertion's intent: descendant captured before kill, orphan re-parents to init, reaper kills it by recorded identity, exited-PID reuse guard prunes without a bogus kill. Rules out deleting or weakening these checks.
- Reproduce the flake under the full parallel suite under load before choosing the mechanism; pin it to the observed cause. Candidate mechanisms (intent-sanctioned): widen only these tests' poll deadlines / make them poll-until-with-bounded-deadline rather than fixed-time, a retry-on-timing wrapper scoped to these two tests, or serialize just these process-spawning tests outside the parallel pool. Rules out widening the global suite timeout or dropping `--parallel`.

## Task checklist

- [ ] Reproduce the two tests flaking under the loaded full parallel suite; confirm green in isolation.
- [ ] Apply the per-test stabilization mechanism to `reap.test.ts` only.
- [ ] Confirm the two tests pass in isolation and inside the full `bun run test` run, repeatably.

## Acceptance criteria

- [ ] The two named `DescendantTracker` tests in `v1/test/modes/patch/reap.test.ts` pass both in isolation and inside the full `bun run test` run, repeatably under load.
- [ ] Their assertion intent is preserved: pre-kill descendant capture, re-parent-to-init detection, identity-based reap, and the exited-PID reuse guard each still verify the same behavior (no deleted or weakened checks).
- [ ] No change to `v1/src/modes/patch/reap.ts`; changes are confined to `reap.test.ts` and any test-only helper it imports.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- None. Test-only timing change with no observable testing contract; `v2/docs/v1-behaviors.md` unchanged.
