# Base-ref probe runs the terminal ready-step scoped command

Follow-up to landed `gate-repair-fence` (#2665/#2666). Subspec 01 wired base-ref reproduction through `buildBaseRefProbeCommandArgs` and `createDefaultReproduceReadyGateAtBaseRef`, but the shipped helper's dead branch leaves both arms as raw `bun test <path>`. Env-sensitive tests fail under that invocation at `baseRef` → probe returns `fail` → path lands in `confirmedOutsidePaths` → gate settles `ready_gate_out_of_scope` and refuses repair for a genuinely caused failure.

## Decision ledger

- The default base-ref probe invokes the terminal failing ready-step's scoped test runner for `[failingPath]` only — not hardcoded raw `bun test <path>` and not the full scoped-script roster at `baseRef` — rules out env-sensitive misclassification and preserves the per-path wall-time bound from `gate-repair-fence` subspec 01.
- For terminal `bun run test:v2` / `bun run test:integration:v2` steps, call `runV2TestFiles` with mode derived from the script (`agent` / `integration`) and a single-file roster — rules out argv `bun run test:v2 <path>` because `scripts/run-v2-tests.ts` CLI reads only `argv[2]` and ignores per-file filters.
- Deferred to first consumer: per-file scoped runner routing for other terminal `bun run test:*` steps (v1/shared) — pin when ready gate reports those commands as the terminal failing step.
- Default probe subprocess forwards ready-gate child env (`JARVIS_READY_TIER: "full"`, `JARVIS_READY_TEST_SCOPE` derived the same way as `createDefaultRunReadyGate`) — rules out env-only parity via argv shape alone.
- Fail-open probe errors still classify in scope — rules out tightening `gate-repair-fence` subspec 01's fail-open contract.

## Task checklist

- Replace the dead-branch raw `bun test` path in `buildBaseRefProbeCommandArgs` / `createDefaultReproduceReadyGateAtBaseRef` (`v2/src/execution/ready-finalize.ts`) with scoped single-file runner invocation for v2 terminal test steps.
- Forward ready-gate child env on the default probe subprocess.
- Add pinning regression `base-ref probe invokes the terminal ready-step scoped command` in `v2/src/execution/ready-finalize.test.ts` with a `// @mutate` directive reverting the probe to raw `bun test`.
- Optionally align `v2/docs/write-behavior.md` base-ref probe wording to exclude raw `bun test` if that paragraph is edited.

## Acceptance criteria

- [ ] `v2/src/execution/ready-finalize.test.ts` — test titled `base-ref probe invokes the terminal ready-step scoped command` drives the default base-ref probe for a failing path and asserts the probe uses the terminal step's scoped runner (single-file roster and ready-gate child env), not raw `bun test <path>`; fails against the current dead-branch raw invocation.
- [ ] In `v2/src/execution/ready-finalize.test.ts`, the test titled `base-ref probe invokes the terminal ready-step scoped command` carries a `// @mutate` directive reverting the probe to raw `bun test`; the mutation turns that test RED.
- [ ] `ready-finalize.test.ts` tests titled `base-ref reproduction classifies a base-passing worktree-failing path as in scope`, `base-ref probe failure classifies in scope`, and `classifies fully attributed terminal failures outside the allowed set as out of scope` stay green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- Optional clarification only: `v2/docs/write-behavior.md` already states the probe re-runs the terminal step's scoped test command; align wording to exclude raw `bun test` if touched. No `v1-behaviors.md` change (bugfix-to-docs alignment).
