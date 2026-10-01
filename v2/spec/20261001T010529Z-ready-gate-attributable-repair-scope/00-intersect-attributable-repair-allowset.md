# Intersect attributable repair allowset with frozen gate envelope

Non-test ready gates with lint-style attribution build `resolveAttributableRepairAllowset` from attributable failing paths alone, so a pre-existing lint red on a path outside the frozen run diff still authorizes agent repair edits there even though completion-commit fencing would refuse the same path.

## Decision ledger

- For non-test gates with attributable paths, agent and autofix fence validation use `{ p ∈ attributable | p ∈ resolveGateRepairAllowset(frozen, error) }` — rules out an attributable-only allowset that widens repair beyond the frozen diff/spec envelope plus per-gate `gateRepairAllowsetPaths` extensions.
- When every attributable failing path lies outside `resolveGateRepairAllowset(frozen, error)`, settle `ready_gate_out_of_scope` before autofix or bounded agent repair (no `ready_gate_repair` events) with `readyGateOutsidePaths` naming those paths — rules out entering repair on lint-attributed pre-existing out-of-diff failures that `selectTerminalFailingPaths` never feeds into base-ref classification.
- Ready test gates and gates with no attributable paths keep today’s `resolveGateRepairAllowset(frozen, error)` allowset — rules out applying lint-style intersection to test-command repair.
- Out-of-envelope settlement reuses existing `ready_gate_out_of_scope` resumability and operator mirrors from unchanged-path out-of-scope work; this subspec does not reopen that policy — rules out inventing a parallel terminal kind.

## Task checklist

- Narrow `resolveAttributableRepairAllowset` in `v2/src/execution/ready-finalize.ts` to the intersection contract above; keep refusal messaging coherent when the attributable set is narrower than the frozen allowset.
- Short-circuit `publishWithReadyRepair` (after fence freeze, before autofix) when attributable paths are present but none lie in `resolveGateRepairAllowset`, upgrading the publish outcome to `ready_gate_out_of_scope`.
- Add a ready-gate repair integration regression under `write-loop.test.ts` `ready-gate repair fence` (or `ready-finalize.test.ts` unit coverage plus integration) for a lint failure attributable only to a path outside the run diff.
- Pin intersection behavior in `ready-finalize.test.ts` when a dedicated unit test is the clearer failing surface.

## Acceptance criteria

- [x] `v2/src/execution/write-loop.test.ts` adds a regression where a non-test ready gate fails with lint-style attribution only on a path outside the frozen run diff: no agent repair edit lands on that path, no `ready_gate_repair` log events fire, and the run settles `ready_gate_out_of_scope`; fails against the pre-fix `resolveAttributableRepairAllowset`.
- [x] `write-loop.test.ts` "never invokes repair for a fully attributed untouched-path gate" stays green.
- [x] `write-loop.test.ts` "repair refuses a staged path outside the attributable allowset" stays green.
- [x] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/workflow-runner.md` — ready-gate repair attributable allowset is intersected with the frozen run-diff envelope (including per-gate extensions); wholly out-of-envelope attributable lint failures settle out-of-scope without repair.
- `v2/docs/v1-behaviors.md` — catalog attributable repair allowset intersection with the frozen fence and out-of-envelope lint settlement.

## Blocker

Artifact contract check failed: Unticked non-human-only acceptance criteria:
- `v2/src/execution/write-loop.test.ts` adds a regression where a non-test ready gate fails with lint-style attribution only on a path outside the frozen run diff: no agent repair edit lands on that path, no `ready_gate_repair` log events fire, and the run settles `ready_gate_out_of_scope`; fails against the pre-fix `resolveAttributableRepairAllowset`.
- `write-loop.test.ts` "never invokes repair for a fully attributed untouched-path gate" stays green.
- `write-loop.test.ts` "repair refuses a staged path outside the attributable allowset" stays green.
- `bun run typecheck` passes.
- `bun run test:v2` passes.
- `bun run test:integration:v2` passes.
