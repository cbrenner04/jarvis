---
name: gate-repair-baseref-probe-runs-scoped-command
---

# Base-ref reproduction probe runs raw `bun test`, not the terminal ready-step's scoped command

Follow-up to `gate-repair-fence` (landed #2665/#2666). Subspec 01 decided the base-ref reproduction probe re-runs "each terminal failing ready-step's **scoped command** at `baseRef`". The shipped implementation does not: `buildBaseRefProbeCommandArgs` (`v2/src/execution/ready-finalize.ts`) has a dead branch — both arms return `["test", failingPath]` — so the default probe seam runs raw `bun test <path>` at the base worktree instead of the step's scoped command (e.g. `test:v2` via `scripts/run-v2-tests.ts`, which sets tier/scope env + runner setup).

## Problem

A ready-step whose failing test depends on the scoped runner's environment errors under raw `bun test <path>` at base → the probe returns `fail` → the path lands in `confirmedOutsidePaths` → the gate settles `ready_gate_out_of_scope` and refuses repair — re-stranding a genuinely caused failure, the exact bug `gate-repair-fence` set out to kill. Bounded today: bunfig preload auto-loads, so most v2 files run under raw `bun test`; the gap bites only tests that need the scoped runner env.

## Evidence

- 2026-08-06 subagent review of the `gate-repair-fence` 00/01 increment (#2665) flagged the dead branch: `buildBaseRefProbeCommandArgs` ignores `terminalCommand`. The `// @mutate` at `ready-finalize.test.ts` pins the comparison DIRECTION (`outcome === "pass"`) but not the command FIDELITY, so no test caught the deviation.

## Decisions

- The base-ref probe invokes the terminal failing ready-step's command form (its scoped test runner), not a hardcoded raw `bun test <path>` — rules out env-sensitive tests misclassifying as out of scope at base.
- Keep the probe scoped to the failing files the gate already reports (do not run the full suite at base) — preserves the wall-time bound from subspec 01.
- Preserve fail-open: a probe that cannot run still classifies in scope.

## Acceptance criteria

- [ ] `ready-finalize.test.ts` — a regression drives the base-ref probe for a failing path and asserts it runs the terminal ready-step's scoped command form (not raw `bun test <path>`); fails against the current dead-branch raw invocation.
- [ ] The `buildBaseRefProbeCommandArgs` dead branch is removed or genuinely differentiates by `terminalCommand`.
- [ ] Mutation checkpoint: a `// @mutate` directive (inside the pinning test body) reverting the probe to raw `bun test` turns the regression RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — base-ref reproduction probe runs the failing step's scoped command form, not raw `bun test`.

## Prerequisites

- `gate-repair-fence` base-ref classification (`classifyReadyGateFailure`, `buildBaseRefProbeCommandArgs`, `probeOutsidePathsAtBaseRef` in `v2/src/execution/ready-finalize.ts`).
- The terminal ready-step record carries its scoped command (`terminalCommand`) into classification.
