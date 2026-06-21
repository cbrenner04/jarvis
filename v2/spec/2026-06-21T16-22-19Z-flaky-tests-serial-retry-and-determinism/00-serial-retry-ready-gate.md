# Serial-retry the test step at the ready gate

## Problem

`scripts/ready.ts` (`runReady`) runs ordered commands and exits on the first non-zero
(`process.exit(code)`). The test step is `bun run test` == `bun test --parallel`. Load-sensitive
tests flake under `--parallel` on a loaded machine and false-block an otherwise-green gate. The
operator's manual recovery is to re-run the failing tests serially; if they pass, it was a
parallel-load flake. Bring that recovery into the gate with no false-pass risk.

## Decisions

- Serial-retry triggers only on the test step (`bun run test`) failure — rules out retrying
  typecheck/check/install failures, which are not load-sensitive flakes.
- The serial re-run runs `bun test` without `--parallel` (not `bun run test`) — rules out
  re-running the same `--parallel` command, which would just re-flake instead of isolating the
  load sensitivity.
- Re-run the whole suite serially, not a parsed subset of reported failures — rules out scraping
  failed-test names from `bun test` output (fragile parsing; a missed name silently drops a real
  failure). A whole-suite serial pass cannot hide a genuine failure.
- Gate verdict on test failure == serial re-run result: serial green proceeds to the remaining
  commands; serial red exits non-zero surfacing the serial failure — rules out any auto-pass
  decoupled from the serial outcome (preserves no-false-pass).
- Exactly one serial re-run, not a retry loop — rules out looping until pass, which would spin on
  (or mask) a real failure.
- The serial re-run goes through the existing `runCommand`/deadline accounting (shared overall
  timeout, elapsed carried forward) — rules out an unbounded serial run that ignores the gate
  deadline.

## Task checklist

- [ ] In `runReady`, detect the test step failure and run one serial `bun test` re-run before
      declaring red.
- [ ] Keep the failing-command-exits-immediately behavior for all non-test steps.
- [ ] Log the serial re-run so the operator/agent sees it (distinct from the parallel run).
- [ ] Add unit tests in `v1/test/ready-script.test.ts` via the `runCommandFn` seam: serial-green
      recovers (remaining commands run, gate succeeds) and serial-red still fails (serial command
      invoked, gate exits non-zero).

## Acceptance criteria

- [ ] When the ready gate's `bun run test` step exits non-zero, the gate runs the suite serially
      (`bun test` without `--parallel`) exactly once before declaring the test step failed.
- [ ] A serial re-run that passes makes the gate treat the test step as green and continue to the
      remaining commands (e.g. `check`); the gate ultimately succeeds.
- [ ] A serial re-run that fails makes the gate exit non-zero with the serial failure surfaced (no
      false-pass on a genuinely broken test).
- [ ] A failure in any non-test step (`install`, `check:fix`, `typecheck`, `check`) exits
      immediately with no serial re-run, as before.
- [ ] `v1/test/ready-script.test.ts` covers serial-green-recovers and serial-red-still-fails
      through the `runCommandFn` seam.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md`: record the ready gate's serial-retry-on-test-failure behavior (test
  step only; one serial `bun test` re-run; serial result is the verdict; non-test steps unchanged).
