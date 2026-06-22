# Serial-retry harness-controlled suite runs (base-ref + snapshot retest)

## Problem

Seed-3 serial-retry lives only in `scripts/ready.ts` (`runReady`). Two other
suite runs the harness shells during blocker validation treat any non-zero
`bun run test` as non-green with no retry:

- `runBaseRefTests` (`v1/src/modes/patch/base-ref-test-runner.ts`) — runs
  `bun run test` in a throwaway worktree at the merge-base to check whether a
  pre-existing-failure blocker reproduces. A flake here makes the base look red,
  so a rejectable blocker instead stands (exit 7).
- `runSnapshotUpdateRetest` (`v1/src/modes/patch/snapshot-update-retest-runner.ts`)
  — re-runs `bun run test` after an update-snapshots pass. A flake here reports
  "still failing", so the blocker stands (exit 7).

Same parallel-load flake class as the gate, different code path, no protection.

## Decisions

- Apply serial-retry to the **test invocation only** in each runner: on a
  non-zero `bun run test`, re-run once as `bun test` (drop `--parallel`, same
  discovery, no path/filter args) before treating the run as non-green — rules
  out re-running `bun run test` (re-flakes) and rules out a divergent serial
  subset.
- Exactly one serial re-run, not a loop — rules out spinning on a real failure.
- Base-ref re-run executes in the **same throwaway worktree** before cleanup —
  rules out provisioning a second worktree.
- Snapshot re-run executes in the **same agent working dir** as the first
  re-test — rules out a divergent location.
- Do **not** serial-retry the non-test steps in these runners: git
  `merge-base`/`worktree add` setup and the update-snapshots command failure
  stay terminal-non-green — rules out retrying failures that are not
  load-sensitive flakes.
- These runners carry **no harness deadline** (synchronous `execFileSync`),
  unlike the gate; the retry fires on any non-zero test exit. Deferred to first
  consumer: a per-runner serial-run timeout — pin when a caller needs it.
- Serial re-run still treats any non-zero exit as non-green (fail-safe), matching
  each runner's existing contract — rules out a green-by-default on the retry.
- Emit a distinct stderr line when the serial re-run recovers a flake (parallel
  red → serial green), mirroring the gate's operator-visible signal — rules out
  silently masking that a flake was suppressed.

## Task checklist

- [ ] In `runBaseRefTests`, on non-zero `bun run test` run one serial `bun test`
      in the same worktree before returning non-green.
- [ ] In `runSnapshotUpdateRetest`, on non-zero re-test run one serial `bun test`
      in the agent working dir before returning non-green.
- [ ] Log a distinct serial-recovered line in each runner.
- [ ] Extend `v1/test/snapshot-update-retest-runner.test.ts` for serial-green-
      recovers and serial-red-still-fails.
- [ ] Add base-ref runner coverage (serial-green-recovers, serial-red-still-fails)
      via the runner's command seam or a co-located test.

## Acceptance criteria

- [ ] When `runBaseRefTests`' `bun run test` exits non-zero, the runner re-runs
      the suite serially (`bun test`) exactly once; serial-green is reported as
      base-green, serial-red as base-non-green.
- [ ] When `runSnapshotUpdateRetest`' re-test exits non-zero, the runner re-runs
      the suite serially (`bun test`) exactly once; serial-green is reported as
      retest-green, serial-red as retest-non-green.
- [ ] A failure in a non-test step (git setup in base-ref; the update-snapshots
      command in snapshot retest) returns non-green immediately with no serial
      re-run.
- [ ] Each runner emits a distinct stderr line when the serial re-run recovers a
      parallel-load flake (parallel red → serial green).
- [ ] `v1/test/snapshot-update-retest-runner.test.ts` covers serial-green-recovers
      and serial-red-still-fails; base-ref runner coverage asserts the same two
      outcomes.
- [ ] Existing `runBaseRefTests`/`runSnapshotUpdateRetest` blocker-validation
      behavior is otherwise unchanged: `run.test.ts` blocker base-ref and
      snapshot-churn tests stay green.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md`: the serial-retry-on-test-failure behavior (line ~54)
  now also wraps the base-ref and snapshot-update re-test suite runs (test
  invocation only; one serial `bun test`; serial result is the verdict; non-test
  steps unchanged). Note this on the blocker-validation entry (line ~339) too.
