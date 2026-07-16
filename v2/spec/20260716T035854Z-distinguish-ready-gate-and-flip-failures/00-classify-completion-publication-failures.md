# 00 - Classify completion publication failures

## Problem

V2 reports both a red ready gate and a failed draft-to-ready flip as
`ready_finalize_failed`, so workflow results, logs, `wait`, and `run list` cannot identify
which boundary failed.

## Decisions

- Emit `ready_gate_failed` for a red gate and `ready_flip_failed` for a failed `gh pr ready`; rules out retaining or emitting `ready_finalize_failed`.
- Expose gate and flip details in their correspondingly named workflow result fields; rules out preserving the ambiguous `readyFinalizeError` field.
- Keep both ready failures retryable with `nextAction: "resume"` and durable run status `completed`; rules out changing completion or recovery semantics while reclassifying evidence.
- Keep commit, push, PR creation, and body-refresh failures under `completion_commit_failed`; rules out classifying pre-gate publication failures as ready failures.
- Retain red-gate repair and never run it for flip failures; rules out changing the repair path in this slice.

## Scope

- Carry the three publication classifications through standalone and workflow results, `loop_finished`, CLI result serialization, `wait`, and `run list`.
- Preserve successful publication → green gate → ready flip ordering and result.

## Acceptance criteria

- [x] A regression test in `v2/src/execution/workflow-runner.test.ts` independently drives pre-gate publication, ready-gate, and ready-flip failures through workflow completion publication and asserts `completion_commit_failed`, `ready_gate_failed`, and `ready_flip_failed` in both the workflow result and `loop_finished`; it fails against the pre-fix code.
- [x] Standalone write-loop tests in `v2/src/execution/write-loop.test.ts` prove exhausted, budget-limited, and blocked red-gate repair ends as retryable `ready_gate_failed`, while a flip failure ends as retryable `ready_flip_failed` without repair.
- [x] Ready-gate and ready-flip results expose `readyGateError` and `readyFlipError`, respectively; `readyFinalizeError` and emitted `ready_finalize_failed` outcomes are removed from the closed v2 result and log contracts.
- [x] `v2/src/daemon/run-operator-error.test.ts` and daemon `list`/`wait` tests prove each ready outcome produces its matching retryable error reason with `nextAction: "resume"`; completed-run resume accepts both outcomes and still accepts `completion_commit_failed`.
- [x] CLI serialization and exit-code tests prove both ready outcomes retain exit `1` and expose the matching error detail.
- [x] Existing green-gate/ready-flip success tests in `v2/src/execution/ready-finalize.test.ts` and completion-publication tests stay green.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [x] `v2/docs/workflow-runner.md`, `v2/docs/write-behavior.md`, `v2/docs/daemon-host.md`, `v2/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md` describe the distinct publication, gate, and flip outcomes, evidence, exit behavior, and unchanged resume eligibility.

## Documentation updates

- `v2/docs/workflow-runner.md` — workflow publication outcomes and result fields.
- `v2/docs/write-behavior.md` — authoritative finalization, repair, result, and exit contracts.
- `v2/docs/daemon-host.md` — `list`/`wait` reasons and resume eligibility.
- `v2/docs/operator-runbook.md` — operator diagnosis and retry guidance.
- `v2/docs/v1-behaviors.md` — replace the overloaded v2 parity record.
