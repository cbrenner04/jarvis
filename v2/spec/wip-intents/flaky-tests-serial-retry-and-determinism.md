# Reduce flaky false-blocks: serial-retry failed tests + agent-runnable determinism

## Problem

Load-sensitive tests (process-tree spawns, timing) flake under `bun test --parallel` and
false-block a green completion/subspec gate. This session they false-blocked F twice and #10's
run; the agent even misdiagnosed a real regression as "flaky." Worse, process-spawning tests
**can't run in the coding agent's sandbox at all**, so a stabilization spec for them is
un-runnable by the agent — it can only block.

The operator's manual recovery was: on a red gate, re-run the *failing test(s) in isolation /
serially*; if they pass, it was a parallel-load flake → finalize. We want that resilience in the
harness, with no false-pass risk and no new human step — and we want new tests written so they
don't reintroduce the flake.

## Direction

Two levers, both using what exists:

- **Serial-retry at the gate.** The ready gate (`scripts/ready.ts` command loop) bails on the
  first non-zero command. On a `bun run test` failure, re-run the failed tests serially (no
  `--parallel`, e.g. a serial re-run of just the reported failures, or the whole suite serially)
  before declaring red. A genuinely broken test still fails serially → no false-pass. This is
  general flaky-resilience, broader than #15 (which de-flaked two specific tests).
- **Determinism convention.** Generalize the #15 pattern as a standing convention: agent-runnable
  tests must not spawn real processes or depend on wall-clock timing — use DI seams / injected
  process tables. This makes the previously un-runnable tests runnable in the sandbox and removes
  any need for a per-spec "needs unsandboxed validation" escape hatch.

## Out of scope

- Auto-*passing* a flaky gate or auto-finalizing — the serial re-run must still fail on a real
  failure. No reduction in correctness.
- New human-in-the-loop steps or per-spec flags.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record the gate's serial-retry-on-test-failure behavior.
- The determinism convention belongs in `v2/docs/coding-standards` / test-writing guidance.

## References

- `scripts/ready.ts` — `getReadyCommands` (~`:192`), command loop (~`:311`); `bun run test` ==
  `bun test --parallel` (`package.json`).
- `v1/src/ready-gate.ts` — gate wrapper around `bun run ready`.
- `v2/spec/2026-06-20T21-30-42Z-stabilize-flaky-process-timing-tests/` (#329, #15) — the DI-seam /
  injected-table pattern to generalize.
