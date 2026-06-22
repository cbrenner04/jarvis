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

This subspec does **not** fix the observed incident (codex shelling `bun run
test` mid-work, exit 7) — that path is the agent's own command, which the harness
does not wrap and cannot wrap. It hardens two separate, real harness-controlled
gaps. The observed path is addressed (best-effort) by subspec 01's prompt
guidance.

## Decisions

- Apply serial-retry to the **test invocation only** in each runner: on a
  non-zero `bun run test`, re-run once as `bun test` (drop `--parallel`, same
  discovery, no path/filter args) before treating the run as non-green — rules
  out re-running `bun run test` (re-flakes) and rules out a divergent serial
  subset.
- Introduce a `runCommandFn`-style injectable test-invocation parameter into both
  `runBaseRefTests` and `runSnapshotUpdateRetest`, mirroring `scripts/ready.ts`,
  so the parallel and serial invocations route through one seam tests can drive —
  rules out the current direct `execFileSync` calls, which have no seam (the
  snapshot runner's only existing seam is the *update* command, not the test
  invocation) and would leave the serial path untestable.
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
- Accept the added serial wall-time on a genuine red: blocker validation now pays
  a full parallel suite **plus** a full serial run, undeadlined. Acceptable
  because blocker validation is rare and off the implementation hot path — rules
  out gating this behind a timeout/opt-out now.
- `bun run test` → `bun test` equals "drop `--parallel`" **only because jarvis's
  `package.json` test script is `bun test --parallel`**. These runners operate on
  the *target* worktree, which need not use bun test; there the serial re-run is
  fail-safe — a non-bun target yields the same non-green it already returned, so
  the retry never *creates* a false-block, at worst fails to recover one. This is
  inherited from the gate, not introduced here.
- Serial re-run still treats any non-zero exit as non-green (fail-safe), matching
  each runner's existing contract — rules out a green-by-default on the retry.
- Mirror the gate's full operator signal in **both** runners: a retry-starting
  line, a recovered line (parallel red → serial green), and a serial-still-failed
  line — rules out the base-ref runner's current silent failure leaving the
  operator blind on serial-still-red.

## Task checklist

- [ ] Add a `runCommandFn`-style injectable test-invocation parameter to
      `runBaseRefTests` and `runSnapshotUpdateRetest` (mirroring `scripts/ready.ts`).
- [ ] In `runBaseRefTests`, on non-zero `bun run test` run one serial `bun test`
      in the same worktree before returning non-green.
- [ ] In `runSnapshotUpdateRetest`, on non-zero re-test run one serial `bun test`
      in the agent working dir before returning non-green.
- [ ] Emit retry-starting, serial-recovered, and serial-still-failed stderr lines
      in each runner.
- [ ] Extend `v1/test/snapshot-update-retest-runner.test.ts` for serial-green-
      recovers and serial-red-still-fails via the injected command seam.
- [ ] Add base-ref runner coverage (serial-green-recovers, serial-red-still-fails)
      via the injected command seam.

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
- [ ] Each runner emits all three operator signals: a retry-starting line, a
      recovered line on parallel-red → serial-green, and a serial-still-failed
      line on parallel-red → serial-red.
- [ ] Both runners accept an injectable test-invocation command (`runCommandFn`-
      style); `v1/test/snapshot-update-retest-runner.test.ts` and the base-ref
      runner coverage drive serial-green-recovers and serial-red-still-fails
      through that seam.
- [ ] Existing `runBaseRefTests`/`runSnapshotUpdateRetest` blocker-validation
      behavior is otherwise unchanged: `run.test.ts` blocker base-ref and
      snapshot-churn tests stay green.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md`: the serial-retry-on-test-failure behavior entry now
  also wraps the base-ref and snapshot-update re-test suite runs (test invocation
  only; one serial `bun test`; serial result is the verdict; non-test steps
  unchanged). Note this on the blocker-validation entry too.
