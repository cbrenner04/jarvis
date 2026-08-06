# Base-ref scope classification

Ready-gate repair today treats diff membership as the sole out-of-scope signal, stranding caused failures as `ready_gate_out_of_scope` with `resumable: true` over a condition no resume can change.

## Decision ledger

- Scope is decided by whether the failure reproduces on the run's `baseRef`, not diff membership alone — rules out path membership as the sole out-of-scope signal.
- A failure that passes on base and fails in the worktree is in scope; repair proceeds and the failing file joins the repair allowset for that gate only — rules out refusing repair and widening the frozen diff fence generally.
- The base-ref probe is scoped to attributable failing paths the terminal ready step already reported — rules out doubling gate wall time.
- Base-ref reproduction re-runs each terminal failing ready-step's scoped command at `baseRef` through an injected seam (same step command and attributable paths the gate reported), not a second full `bun run ready` — rules out doubling gate wall time and opaque worktree snapshot diffs.
- A probe that cannot run classifies in scope so repair is attempted — rules out fail-closed behavior whose only outcome is an unrecoverable row.
- Conservative attribution rules from the untouched-path classifier remain unchanged: mixed, absent, malformed, stale-retry, later-non-test, and partial attribution stay `ready_gate_failed`.
- Deferred to first consumer: exact probe error surface on the classified `ReadyGateError` — pin when a caller needs it.

## Task checklist

- Add a base-ref reproduction seam to `classifyReadyGateError` / `classifyReadyGateFailure` in `v2/src/execution/ready-finalize.ts`.
- Thread per-gate allowset extension (frozen diff/spec allowset plus in-scope attributable failing paths for the active gate) into ready-gate repair entry in `publishWithReadyRepair`.
- Add unit regressions in `v2/src/execution/ready-finalize.test.ts` and an integration regression in `v2/src/execution/write-loop.test.ts`.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts` adds a pre-fix-failing regression that drives a red gate whose failing file is outside the run diff but passes on `baseRef`, asserts the run classifies in scope, admits repair, and adds only that file to the repair allowset for that gate.
- [ ] A red gate whose failing file also fails on `baseRef` still settles `ready_gate_out_of_scope` with that path named; `ready-finalize.test.ts` "classifies fully attributed terminal failures outside the allowed set as out of scope" and "keeps mixed, absent, malformed, stale-retry, later-non-test, and partial attribution on ready_gate_failed" stay green.
- [ ] `ready-finalize.test.ts` adds a pre-fix-failing regression that a base-ref probe failure classifies in scope; `write-loop.test.ts` asserts repair is attempted and the probe error is reported.
- [ ] In `ready-finalize.test.ts`, a `// @mutate` directive inverting the base-ref comparison guard turns its pinning test RED.

## Documentation updates

- `v2/docs/write-behavior.md` — base-ref reproduction probe, per-gate allowset addition, and updated out-of-scope meaning (fails on base too).
- `v2/docs/v1-behaviors.md` — record v2 ready-gate repair base-ref scope contract.
