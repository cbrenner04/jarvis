# Base-ref probe runs the terminal ready-step scoped command

Follow-up to landed `gate-repair-fence` (#2665/#2666). Subspec 01 wired base-ref reproduction through `buildBaseRefProbeCommandArgs` and `createDefaultReproduceReadyGateAtBaseRef`, but the shipped helper's dead branch leaves both arms as raw `bun test <path>`. Env-sensitive tests fail under that invocation at `baseRef` → probe returns `fail` → path lands in `confirmedOutsidePaths` → gate settles `ready_gate_out_of_scope` and refuses repair for a genuinely caused failure.

## Decision ledger

- **Default probe execution contract (v2 terminal steps):** for terminal failing steps `bun run test:v2` and `bun run test:integration:v2`, `createDefaultReproduceReadyGateAtBaseRef` reproduces the terminal step's scoped runner for `[failingPath]` only via `runV2TestFiles` (mode `agent` / `integration` from `terminalCommand`, single-file roster) — not raw `bun test <path>`, not full-roster `bun run test:*` argv, and not merely flipping argv in `buildBaseRefProbeCommandArgs`. Flipping argv alone cannot satisfy the contract because `scripts/run-v2-tests.ts` CLI reads only `argv[2]`.
- **`buildBaseRefProbeCommandArgs` residual role:** remains the argv builder for non-v2 subprocess fallback only (v1/shared terminal `bun run test:*`, aggregate `bun run test` when scope is `full`, and any terminal step without a pinned per-file scoped runner). V2 terminal steps route through `runV2TestFiles` in the default probe, not through this helper's argv.
- **Scope-env derivation vs probe execution worktrees:** `JARVIS_READY_TEST_SCOPE` (and `JARVIS_READY_TIER: "full"`) are derived the same way as `createDefaultRunReadyGate` — diff `<scope.baseRef>...HEAD` plus untracked inventory from the **run worktree** (`scope.worktreePath`) — while test execution stays in the detached **base** worktree. Rules out deriving scope from the base snapshot and shipping a second misclassification path.
- **Non-v2 residual probe behavior (intentional deferral):** after this subspec lands, v1/shared terminal `bun run test:*` steps and aggregate `bun run test` (when scope is `full`) retain the current raw `bun test <path>` subprocess probe via `buildBaseRefProbeCommandArgs` until a follow-up consumer pins per-file scoped-runner routing for those commands.
- Fail-open probe errors still classify in scope — rules out tightening `gate-repair-fence` subspec 01's fail-open contract.

## Task checklist

- In `createDefaultReproduceReadyGateAtBaseRef` (`v2/src/execution/ready-finalize.ts`), route v2 terminal failing steps (`bun run test:v2`, `bun run test:integration:v2`) through `runV2TestFiles` with mode derived from `terminalCommand` and a single-file roster; keep `buildBaseRefProbeCommandArgs` for the non-v2 subprocess fallback only.
- Derive `JARVIS_READY_TEST_SCOPE` from `scope.worktreePath` against `scope.baseRef` (same as `createDefaultRunReadyGate`); forward ready-gate child env on subprocess fallback paths.
- Add pinning regression `base-ref probe invokes the terminal ready-step scoped command` in `v2/src/execution/ready-finalize.test.ts` parameterized over `bun run test:v2` and `bun run test:integration:v2`, with a machine-parseable `// @mutate` directive reverting v2 scoped-runner invocation to raw `bun test`.
- Optionally align `v2/docs/write-behavior.md` base-ref probe wording to exclude raw `bun test` if that paragraph is edited.

## Acceptance criteria

- [ ] `v2/src/execution/ready-finalize.test.ts` — test titled `base-ref probe invokes the terminal ready-step scoped command` drives the default base-ref probe for a failing path with `terminalCommand` `bun run test:v2` and with `bun run test:integration:v2` (parameterized or paired cases) and primarily asserts scoped-runner shape: `runV2TestFiles` with a single-file `[failingPath]` roster and mode `agent` vs `integration` derived from `terminalCommand`, not raw `bun test <path>` and not full-roster `bun run test:*` argv; secondarily asserts ready-gate child env (`JARVIS_READY_TIER`, `JARVIS_READY_TEST_SCOPE` derived from the run worktree against `scope.baseRef`) when the probe uses a subprocess fallback; fails against the current dead-branch raw invocation.
- [ ] In `v2/src/execution/ready-finalize.test.ts`, the test titled `base-ref probe invokes the terminal ready-step scoped command` carries a machine-parseable `// @mutate v2/src/execution/ready-finalize.ts "<unique v2 scoped-runner anchor>" -> "<raw bun test subprocess anchor>"` reverting v2 probe execution to raw `bun test <path>`; the mutation turns that test RED.
- [ ] `ready-finalize.test.ts` tests titled `base-ref reproduction classifies a base-passing worktree-failing path as in scope`, `base-ref probe failure classifies in scope`, and `classifies fully attributed terminal failures outside the allowed set as out of scope` stay green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- Optional clarification only: `v2/docs/write-behavior.md` already states the probe re-runs the terminal step's scoped test command; align wording to exclude raw `bun test` if touched. No `v1-behaviors.md` change (bugfix-to-docs alignment).
