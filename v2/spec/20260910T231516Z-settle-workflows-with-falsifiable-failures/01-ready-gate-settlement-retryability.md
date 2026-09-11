# Ready-gate settlements state honest reissue semantics

## Problem

`readyFailed` in `v2/src/execution/write-loop.ts` settles every ready-gate failure the same way: a `terminalCause` plus a `ReadyGateError`-derived detail, with no statement of what the gate expected, what it observed, or whether reissuing can change the answer. A failure whose `ReadyGateError.baseRefProbeError` is set came from a load-sensitive base-ref reproduction probe whose conditions do change between runs, and is indistinguishable to the operator from a settlement whose conditions do not.

## Decisions

- `readyFailed` populates `operatorFailureRecord` on its `commitTerminalRunSettlement` call; `terminalCause` and `terminalFailureDetail` are unchanged, but `readyFailureResumable` becomes the one predicate whose return value feeds both the record's `retryable` and the existing `loop_finished.resumable`/returned `resumable` field — one computed value, not two independently-derived verdicts on the same run row.
- `readyFailureResumable` is exported unchanged for reuse by subspec 02; the existing per-kind mapping (`ready_gate_out_of_scope` via `outOfScopeSettlementResumable`, `ready_gate_command_missing` false, other kinds true) is the whole predicate. Rules out a second, independently-derived retryability verdict on the same run row.
- **Corrected during hand-landing (2026-09-12), rule 1 of 2:** the original decision gave `readyGateOrigin === "repair_budget_exhausted"` precedence for `retryable: false`. That is wrong. Repair-budget exhaustion is not a fixed point: the run retains its publication checkpoint and `jarvis run resume` re-enters a gate-only finalization tail with no write-agent, which is the documented recovery after an operator hand-fixes a non-autofixable finding (`noExcessiveCognitiveComplexity`, `noNonNullAssertion`). The implementing agent edited one write-loop test to match the flip and left `daemon-resume.test.ts`'s `repeated exhausted-red gate-only resume stays failed/resumable without agent or ready flip` failing, then ticked the criterion claiming `test:v2` passes. The rule is not implemented; `readyGateOrigin` is not an input to the predicate.
- **Corrected during hand-landing (2026-09-12), rule 2 of 2:** the original decision also gave `ReadyGateError.baseRefProbeError !== undefined` precedence for `retryable: true`. That rule is unreachable. `classifyReadyGateFailure` (`ready-finalize.ts`) returns `kind: "ready_gate_failed"` whenever `baseRefProbeError` is set, and the predicate's existing fallback already returns `true` for that kind — so the guard could never change an outcome, and the test proving it hand-built a `ReadyGateError` shape the classifier cannot emit. Removed rather than shipped as a non-falsifiable criterion. Carrying probe evidence onto the `ready_gate_out_of_scope` settlement (the collision the original decision imagined) is real work and is not in this spec.
- What subspec 01 actually lands is the `operatorFailureRecord` on ready-gate settlements, sourced from the same value as `loop_finished.resumable`. That is the seed's purpose; the two retryability rules were invented precision.
- `expectation` states the gate contract and `observation` states the gate's exit and finding state at that settlement; the near miss is omitted here (the gate has no candidate notion).
- The worktree path referenced by a ready-gate settlement is `operator-repository`; rules out renderers inferring ownership from text.
- Retryability derivation stays a pure exported predicate over the settlement inputs (now including `error`), exported for reuse by subspec 02, not inline branching, so both directions are testable directly.

## Task checklist

- [ ] Extend `readyFailureResumable` with the `baseRefProbeError` rule and export it for subspec 02, and add the record builder for ready-gate settlements.
- [ ] Populate the record at `readyFailed`, sourcing `loop_finished.resumable` from the same extended predicate.
- [ ] Tests and docs.

## Acceptance criteria

- [x] `readyFailureResumable` is the single source for both `operatorFailureRecord.retryable` and `loop_finished.resumable` at `readyFailed`, so the two cannot disagree. Both retryability *rules* the original criterion named were withdrawn during hand-landing — see Decisions.
- [x] `v2/src/execution/write-loop.test.ts` proves a ready-gate settlement's record states expectation and observation and references the worktree path with `operator-repository` origin; it fails against the pre-fix verdict-only settlement.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — fixed-point versus changeable ready-gate settlement semantics.
- `v2/docs/v1-behaviors.md` — record the changed ready-gate settlement evidence and retryability behavior.
