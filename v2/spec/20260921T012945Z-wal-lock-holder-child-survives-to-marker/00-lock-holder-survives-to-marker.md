# Lock holder survives to its marker

## Problem

`v2/src/persistence/state-store-wal-concurrency.test.ts` → "second writer on separate connection commits without database is locked" spawns `bun --eval subprocess_lock_holder_script(...)` and awaits `jarvis-lock-held`. CI run 35172007671 on PR #3954 reported a pre-marker child exit, but its cause is not established; the sweep must capture the exit code, signal, and stderr tail before a fix.

## Decisions

- Treat the historical report as a pre-marker-exit premise to confirm, not a diagnosed cause. Rules out choosing a fix from CI run 35172007671 without captured diagnostics.
- Use 20 consecutive `bun run test:v2` passes as the completion gate. Rules out weaker isolated-file repeats or fewer full-suite runs.
- If no pre-marker exit is captured in 20 sweep runs, make no source change. Rules out recording an unreproduced sweep in a spawn comment or shipping a speculative hardening.
- If reproduced, limit the source fix to the lock-holder script or its spawn setup. Rules out changing `waitForStdoutMarker`, whose prerequisite contract must already be present.
- Add a cause comment above the spawn only on the reproduced path. Rules out a generic investigation comment that outlives no code change.

## Acceptance criteria

- [ ] Up to 20 `bun run test:v2` sweep runs either capture a `waitForStdoutMarker` rejection showing a pre-marker child exit with its exit code, signal, and stderr tail, or complete without that failure.
- [ ] If no sweep run captures that failure, no source file is changed.
- [ ] If the failure is captured, only the lock-holder script or its spawn setup removes the diagnosed cause, and a comment above the spawn records that cause from the captured diagnostics.
- [ ] If the failure is captured, a regression test that forces its cause fails against the pre-fix holder and passes after the fix. A deterministic-test exemption is allowed only when the spawn comment names the cause and concrete technical barrier to inducing it without timing or external load; it does not apply merely because no test was attempted.
- [ ] The existing dual-writer test in `v2/src/persistence/state-store-wal-concurrency.test.ts` stays green, including its WAL/busy-timeout coverage.
- [ ] `bun run test:v2` passes 20 consecutive times.
- [ ] `bun run typecheck` passes.

## Documentation updates

- None: test-harness-internal change; a reproduced-path spawn comment is the code-local rationale.
