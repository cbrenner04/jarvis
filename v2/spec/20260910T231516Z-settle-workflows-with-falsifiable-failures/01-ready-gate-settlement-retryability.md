# Ready-gate settlements state honest reissue semantics

## Problem

`readyFailed` in `v2/src/execution/write-loop.ts` settles every ready-gate failure the same way: a `terminalCause` plus a `ReadyGateError`-derived detail, with no statement of what the gate expected, what it observed, or whether reissuing can change the answer. Two ready-gate settlements have opposite retry semantics today and are indistinguishable to the operator: built-in autofix re-entered over unchanged non-autofixable findings is a fixed point (`resume` repeats it forever), while a failure whose `ReadyGateError.baseRefProbeError` is set came from a load-sensitive base-ref reproduction probe whose conditions do change between runs.

## Decisions

- `readyFailed` populates `operatorFailureRecord` on its `commitTerminalRunSettlement` call; `terminalCause` and `terminalFailureDetail` are unchanged, but `readyFailureResumable` becomes the one predicate whose return value feeds both the record's `retryable` and the existing `loop_finished.resumable`/returned `resumable` field — one computed value, not two independently-derived verdicts on the same run row.
- `readyFailureResumable` gains the two inputs `readyFailed` already has at hand: `readyGateOrigin` and `error`. Precedence: `readyGateOrigin === "repair_budget_exhausted"` (built-in autofix re-entered `MAX_READY_GATE_REPAIRS` times over unchanged non-autofixable findings, per `resolveExhaustedReadyGateOrigin`) settles `retryable: false` ahead of any other check; else `error instanceof ReadyGateError && error.baseRefProbeError !== undefined` (a load-sensitive base-ref reproduction probe) settles `retryable: true`; else the existing per-kind mapping (`ready_gate_out_of_scope` via `outOfScopeSettlementResumable`, `ready_gate_command_missing` false, other kinds true) is unchanged. Rules out equating terminal status with a useful retry, rules out terminal treatment of machine-load flakes, and rules out `baseRefProbeError` colliding with `ready_gate_out_of_scope`'s own resumability (the two conditions are checked in this fixed order, on whichever kind each carries).
- `expectation` states the gate contract and `observation` states the gate's exit and finding state at that settlement; the near miss is omitted here (the gate has no candidate notion).
- The worktree path referenced by a ready-gate settlement is `operator-repository`; rules out renderers inferring ownership from text.
- Retryability derivation stays a pure exported predicate over the settlement inputs (now including `readyGateOrigin` and `error`), exported for reuse by subspec 02, not inline branching, so both directions are testable directly.

## Task checklist

- [ ] Extend `readyFailureResumable` with the `readyGateOrigin`/`baseRefProbeError` precedence and export it for subspec 02, and add the record builder for ready-gate settlements.
- [ ] Populate the record at `readyFailed`, sourcing `loop_finished.resumable` from the same extended predicate.
- [ ] Tests and docs.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts` proves a `readyGateOrigin: "repair_budget_exhausted"` settlement (built-in autofix re-entered over unchanged non-autofixable findings) settles both `operatorFailureRecord.retryable` and `loop_finished.resumable` to `false`, while a `baseRefProbeError`-carrying settlement (load-sensitive base-ref reproduction probe) settles both to `true`; it fails against the pre-fix unconditional `true` for `ready_gate_failed`.
- [ ] `v2/src/execution/write-loop.test.ts` proves a ready-gate settlement's record states expectation and observation and references the worktree path with `operator-repository` origin; it fails against the pre-fix verdict-only settlement.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — fixed-point versus changeable ready-gate settlement semantics.
- `v2/docs/v1-behaviors.md` — record the changed ready-gate settlement evidence and retryability behavior.
