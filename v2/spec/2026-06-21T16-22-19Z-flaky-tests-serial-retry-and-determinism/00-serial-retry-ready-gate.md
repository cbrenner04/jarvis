# Serial-retry the test step at the ready gate

## Problem

`scripts/ready.ts` (`runReady`) runs ordered commands and exits on the first non-zero
(`process.exit(code)`). The test step is `bun run test` == `bun test --parallel`. Load-sensitive
tests flake under `--parallel` on a loaded machine and false-block an otherwise-green gate. The
operator's manual recovery is to re-run the failing tests serially; if they pass, it was a
parallel-load flake. Bring that recovery into the gate. Serial re-run cannot mask a
parallel-invariant failure; a genuine parallelism-dependent defect (race, shared-state leak, PID
reuse) that passes serially is a known, accepted residual — it mirrors the operator's manual
procedure exactly.

## Decisions

- Serial-retry triggers only on the test step (`bun run test`) failure — rules out retrying
  typecheck/check/install failures, which are not load-sensitive flakes.
- Detect the test step by matching the configured test command exactly (`bun run test`), not a
  substring of `bun run` — rules out accidentally matching `check`/`check:fix`/`typecheck`, which
  also run via `bun run`.
- Serial-retry fires only on a genuine test-process failure exit, excluding timeout/deadline-kill
  and signal-derived codes (SIGINT/SIGTERM) — rules out launching a useless instant second kill
  after a deadline kill, and rules out converting an operator Ctrl-C into a serial re-run instead
  of an abort.
- The serial re-run runs exactly `bun test` without `--parallel` and with no path/filter args (not
  `bun run test`) — rules out re-running the same `--parallel` command (which would just re-flake),
  and rules out a divergent serial subset: same test-set discovery as the parallel run, only
  `--parallel` dropped.
- Re-run the whole suite serially, not a parsed subset of reported failures — rules out scraping
  failed-test names from `bun test` output (fragile parsing; a missed name silently drops a real
  failure). A whole-suite serial pass cannot hide a genuine failure.
- Gate verdict on test failure == serial re-run result: serial green proceeds to the remaining
  commands; serial red exits non-zero surfacing the serial failure — rules out any auto-pass
  decoupled from the serial outcome. This cannot mask a parallel-invariant failure (a real bug
  fails serially too); the only residual is a genuine parallelism-dependent defect that passes
  serially — accepted, since it mirrors the operator's endorsed manual procedure. No proof of
  zero false-pass is claimed.
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

- [x] When the ready gate's `bun run test` step exits non-zero, the gate runs the suite serially
      (`bun test` without `--parallel`) exactly once before declaring the test step failed.
- [x] A serial re-run that passes makes the gate treat the test step as green and continue to the
      remaining commands (e.g. `check`); the gate ultimately succeeds.
- [x] A serial re-run that fails makes the gate exit non-zero with the serial failure surfaced (no
      false-pass on a genuinely broken test).
- [x] A failure in any non-test step (`install`, `check:fix`, `typecheck`, `check`) exits
      immediately with no serial re-run, as before.
- [x] A test-step exit from timeout/deadline-kill or a signal (SIGINT/SIGTERM) does not trigger a
      serial re-run — only a genuine test-process failure exit does.
- [x] The serial re-run is logged distinctly from the parallel run; serial-green emits an
      operator-visible signal that a parallel-load flake was recovered.
- [x] A serial re-run that exceeds the remaining gate deadline is killed and the gate exits
      non-zero (fail-closed; no special-casing of the serial run's deadline).
- [x] `v1/test/ready-script.test.ts` covers serial-green-recovers and serial-red-still-fails
      through the `runCommandFn` seam.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md`: record the ready gate's serial-retry-on-test-failure behavior (test
  step only; one serial `bun test` re-run; serial result is the verdict; non-test steps unchanged).
