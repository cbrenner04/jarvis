# Route agent mode through the per-file timeout loop

`scripts/run-tests.ts` agent mode runs `bun test --parallel` across all agent files in
one call (`scripts/run-tests.ts:22-27`). A hung file wedges the whole gate with no
named culprit. `scripts/run-v2-tests.ts` already exports `runV2TestFiles`/`aggregateExitCode`,
a per-file spawn/timeout/continue-on-timeout loop used by v2's own agent/integration
test runs.

## Decisions

- Replace the `runBunTest(["test", "--parallel", ...agent])` call in `run-tests.ts` with
  `runV2TestFiles("agent", agent)` + `aggregateExitCode(...)`, matching v2's existing
  per-file timeout and continue-on-timeout semantics for agent mode.
- Integration mode in `run-tests.ts` is untouched (already serial, per-file, own loop).

## Task Checklist

- [ ] Import `runV2TestFiles`/`aggregateExitCode` from `./run-v2-tests.ts` in `run-tests.ts`.
- [ ] Replace the agent-mode `bun test --parallel` call with the per-file loop; exit with
      `aggregateExitCode` when non-zero, matching the existing early-exit-then-integration flow.

## Acceptance criteria

- [x] `run-tests.ts` agent mode, given a file that hangs past `PER_FILE_TIMEOUT_MS`, exits
      non-zero, names that file in stderr, and still runs the remaining agent files.
- [x] `run-v2-tests.test.ts` stays green (behavior of `runV2TestFiles`/`aggregateExitCode`
      unchanged by this reuse).

## Documentation updates

- None: internal script wiring, no operator-facing or documented behavior change (agent-mode
  test running was never a documented contract).
