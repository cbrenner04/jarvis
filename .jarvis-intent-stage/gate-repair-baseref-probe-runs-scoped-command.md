---
name: gate-repair-baseref-probe-runs-scoped-command
---

# Base-ref reproduction probe runs the terminal ready-step's scoped command

Single execution-loop surface (`buildBaseRefProbeCommandArgs` and default base-ref probe in `ready-finalize.ts`); splitting by module boundary does not apply.

## Problem

Follow-up to landed `gate-repair-fence` (#2665/#2666). Subspec 01 decided the base-ref reproduction probe re-runs each terminal failing ready-step's scoped command at `baseRef`. Shipped `buildBaseRefProbeCommandArgs` has a dead branch — both arms return `["test", failingPath]` — so the default probe runs raw `bun test <path>` at the base worktree instead of the step's scoped command (e.g. `test:v2` via `scripts/run-v2-tests.ts`, which sets tier/scope env and runner setup). Env-sensitive tests error under raw `bun test` at base → probe returns `fail` → path lands in `confirmedOutsidePaths` → gate settles `ready_gate_out_of_scope` and refuses repair, re-stranding a genuinely caused failure.

## Decisions

- The base-ref probe invokes the terminal failing ready-step's command form (its scoped test runner), not a hardcoded raw `bun test <path>` — rules out env-sensitive tests misclassifying as out of scope at base.
- Keep the probe scoped to the failing files the gate already reports (do not run the full suite at base) — preserves the wall-time bound from `gate-repair-fence` subspec 01.
- Preserve fail-open: a probe that cannot run still classifies in scope.

## Acceptance criteria

- [ ] `ready-finalize.test.ts` — test titled `base-ref probe invokes the terminal ready-step scoped command` drives the default base-ref probe for a failing path and asserts subprocess argv matches the terminal step's scoped command form (not raw `bun test <path>`); fails against the current dead-branch raw invocation.
- [ ] `buildBaseRefProbeCommandArgs` differentiates by `terminalCommand` — the dead branch that returns `["test", failingPath]` for both arms is removed or fixed.
- [ ] In `ready-finalize.test.ts`, the test titled `base-ref probe invokes the terminal ready-step scoped command` carries a `// @mutate` directive reverting the probe to raw `bun test`; the mutation turns that test RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — base-ref reproduction probe runs the failing step's scoped command form, not raw `bun test`.

## Prerequisites

- `gate-repair-fence` base-ref classification (`classifyReadyGateFailure`, `buildBaseRefProbeCommandArgs`, `probeOutsidePathsAtBaseRef` in `v2/src/execution/ready-finalize.ts`).
- The terminal ready-step record carries its scoped command (`terminalCommand`) into classification.
