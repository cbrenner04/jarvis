---
name: gate-repair-baseref-probe-runs-scoped-command
---

# Base-ref reproduction probe runs the terminal ready-step's scoped command

Single execution-loop surface (`buildBaseRefProbeCommandArgs` and default base-ref probe in `ready-finalize.ts`); splitting by module boundary does not apply.

## Problem

Follow-up to landed `gate-repair-fence` (#2665/#2666). Subspec 01 decided the base-ref reproduction probe re-runs each terminal failing ready-step's scoped command at `baseRef`. Shipped `buildBaseRefProbeCommandArgs` has a dead branch — both arms return `["test", failingPath]` — so the default probe runs raw `bun test <path>` at the base worktree instead of the step's scoped command (e.g. `test:v2` via `scripts/run-v2-tests.ts`, which sets tier/scope env and runner setup). Env-sensitive tests error under raw `bun test` at base → probe returns `fail` → path lands in `confirmedOutsidePaths` → gate settles `ready_gate_out_of_scope` and refuses repair, re-stranding a genuinely caused failure. Terminal scoped commands like `bun run test:v2` drive the full roster through `scripts/run-v2-tests.ts` (CLI reads only `argv[2]`); argv `["run","test:v2",failingPath]` would not honor per-path scoping even if the dead branch were flipped.

## Decisions

- The base-ref probe invokes the terminal failing ready-step's scoped test runner for `[failingPath]` only — not hardcoded raw `bun test <path>` and not the full scoped-script roster at base — rules out env-sensitive misclassification and preserves the per-path wall-time bound from `gate-repair-fence` subspec 01.
- For `bun run test:*` terminal steps, run the scoped runner single-file (e.g. `runV2TestFiles` with mode derived from `terminalCommand`); do not rely on `bun run test:v2` argv because `scripts/run-v2-tests.ts` ignores per-file filters.
- Default probe subprocess forwards ready-gate child env (`JARVIS_READY_TIER`, `JARVIS_READY_TEST_SCOPE`) matching the terminal step; scoped-runner correctness is not argv shape alone.
- Preserve fail-open: a probe that cannot run still classifies in scope.

## Acceptance criteria

- [ ] `v2/src/execution/ready-finalize.test.ts` — test titled `base-ref probe invokes the terminal ready-step scoped command` drives the default base-ref probe for a failing path and asserts the probe uses the terminal step's scoped runner (single-file roster and ready-gate child env), not raw `bun test <path>`; fails against the current dead-branch raw invocation.
- [ ] In `v2/src/execution/ready-finalize.test.ts`, the test titled `base-ref probe invokes the terminal ready-step scoped command` carries a `// @mutate` directive reverting the probe to raw `bun test`; the mutation turns that test RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- Optional clarification only: `v2/docs/write-behavior.md` already states the probe re-runs the terminal step's scoped test command; align wording to exclude raw `bun test` if touched. No `v1-behaviors.md` change (bugfix-to-docs alignment).

## Prerequisites

- `gate-repair-fence` base-ref classification (`classifyReadyGateFailure`, `buildBaseRefProbeCommandArgs`, `probeOutsidePathsAtBaseRef` in `v2/src/execution/ready-finalize.ts`).
- The terminal ready-step record carries its scoped command (`terminalCommand`) into classification.
- `scripts/run-v2-tests.ts` exposes per-file scoped execution via `runV2TestFiles` (full-roster CLI entry reads only mode `argv[2]`).
