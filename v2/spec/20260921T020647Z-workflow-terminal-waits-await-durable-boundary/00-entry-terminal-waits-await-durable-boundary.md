# Subprocess-spawning workflow tests carry an explicit timeout

## Problem

`after detach the workflow reaches workflow entry terminal while the launching CLI has already exited` and `attached run workflow waits through a multi-step workflow until the entry run is terminal` in `v2/src/commands/workflow.test.ts` spawn a CLI child. Both run under bun's default 5000 ms per-test timeout, which includes the child's cold start; under scheduling load the cold start passes 5 s and a correct run goes red at exactly 5000 ms.

## Decisions

- Raise the per-test timeout on exactly these two tests via one named constant `SPAWNED_CLI_TEST_TIMEOUT_MS` (30000) — rules out raising bun's global/default timeout.
- Apply it as the per-test timeout argument of the detach test and of the `attachedSocketTest(...)` registration of the attached test; not inside `assertAttachedEntryTerminalWait` — rules out a helper-level wait/timeout that the registration timeout would not bound.
- The reused-server mutation tests (inverted/retargeted) keep their current form — rules out a suite-wide bounded-wait sweep.
- No polling or new wait is added: the detach test already asserts `fixture.entryTerminal` after `proc.exited`, and the attached helper already awaits `whenEntryWaitPending`; only the timeout is wrong.
- `workflow.test.ts` does not join the declared isolation class here; that classification belongs to `declared-isolation-class-for-wall-clock-bounded-suites`.
- No new regression test: reproducing the failure needs >5 s of real wall-clock, and the change only alters test timing, so it falls under the failing-test exemption for runtime-behavior subspecs.

## Acceptance criteria

- [ ] Both named `workflow.test.ts` tests carry a per-test timeout of `SPAWNED_CLI_TEST_TIMEOUT_MS`, above bun's 5000 ms default; the constant is not applied inside `assertAttachedEntryTerminalWait`, and the two mutation tests are unchanged.
- [ ] `v2/src/commands/workflow.test.ts` stays green in isolation (`bun test v2/src/commands/workflow.test.ts`).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/test-writing.md` states that tests spawning a subprocess need an explicit per-test timeout covering child cold start and must not rely on bun's 5000 ms default, and links waits that are unavoidably bounded to `### Declared isolation classes`.

## Documentation updates

- `v2/docs/test-writing.md` — subprocess-spawning tests set an explicit per-test timeout covering child cold start (never bun's 5000 ms default); unavoidably bounded waits link to `### Declared isolation classes`.
