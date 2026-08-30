# Derive idle-timeout resumability from the checkpoint

## Problem

The write loop checkpoints a settled stall before its SQLite boundary, but discards the checkpoint outcome and hard-codes `resumable: false` on the returned `idle_output_timeout` and terminal `loop_finished`. A stall that preserved fresh committed work is therefore indistinguishable from one whose checkpoint was skipped.

## Sibling sequencing

Signal intent (this spec): derive `loop_finished.resumable` from the boundary checkpoint on first settlement and on idempotent replay. Consumption intent (`v2/spec/ready-intents/idle-timeout-resume-admission.md`): daemon operator-error projection and `jarvis run resume` admission. Until that sibling merges, terminal `loop_finished` may carry `resumable: true` while daemon list/wait/resume still map every `idle_output_timeout` to `nextAction: "stop"` — intentional interim limbo, not accidental omission.

## Prerequisites

- Every settled git-backed write-loop iteration checkpoints before its SQLite boundary and emits `iteration_commit` with either a fresh `commitSha` or a skip reason.
- A settled write-step stall maps to failed `idle_output_timeout` after the checkpoint.

## Decision ledger

- Derive settled `idle_output_timeout` resumability only from that attempt's `checkpointSettledIteration` result being `committed` with a fresh `commitSha`; rules out stale HEAD reuse and inferred worktree progress.
- Keep skipped checkpoint outcomes non-resumable — `no_file_changes` (git-backed stall with no diff; reachable via new idle-watchdog git-backed case and `write-loop.test.ts` `iteration_commit` skip coverage), `no_git` (preserved by `write-loop-idle-watchdog.test.ts` `/fake` worktree case at line 87), and `no_binding` (preserved by `write-loop.test.ts` `no-binding-checkpoint-skip`); rules out reviving empty or uncheckpointed stalls.
- Use one derived value for the returned result and terminal `loop_finished`; rules out disagreement between immediate and logged settlement.
- Preserve `runStatus: "failed"` and `outcomeKind: "idle_output_timeout"` regardless of checkpoint outcome; rules out treating durability as completion or `iteration_timeout`.
- Update `committedResult` to echo terminal `loop_finished.resumable` from durable evidence on idempotent replay, but still return the failed result object (not `null`); rationale — this spec owns settlement-signal accuracy and replay must not downgrade `resumable: true`, while write-loop continuation stays blocked until resume-admission.
- Keep daemon resume admission and operator-error mapping outside this execution-loop change; rules out silently broadening a settle-time signal into an operator recovery workflow without its own contract.

## Tasks

- Retain the settled checkpoint outcome through idle-timeout terminal mapping and derive the `finishLoop` `resumable` value from a fresh commit only; checkpoint precedence unchanged.
- Update `committedResult` for failed `idle_output_timeout` to echo durable terminal resumability without returning `null`.
- Extend `write-loop-idle-watchdog.test.ts` for git-backed committed and skipped checkpoints without replacing the existing `/fake` no-git case.
- Update durable execution and v1-parity documentation; document interim limbo until resume-admission.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop-idle-watchdog.test.ts` drives a stalled git-backed iteration that changes a tracked file, asserts `iteration_commit` carries a fresh `commitSha`, and asserts the returned result and terminal `loop_finished` remain failed `idle_output_timeout` with `resumable: true`; the test fails against the baseline hard `false`.
- [ ] That committed-progress test carries an in-body `// @mutate` directive pinning the fresh-checkpoint resumability guard (the `finishLoop` derivation from checkpoint outcome, e.g. replacing the derived expression with `false`); applying it turns the test RED; no production inversion hook.
- [ ] The same committed-progress test asserts idempotent `executeWriteLoop` re-entry on the failed run echoes `resumable: true` without returning `null`.
- [ ] `v2/src/execution/write-loop-idle-watchdog.test.ts` drives a stalled git-backed iteration with no file changes and asserts `iteration_commit.skipReason: "no_file_changes"` plus `resumable: false` on the returned result and terminal `loop_finished`; regression guard — stays false and would fail if the fresh-commit guard were applied to skipped checkpoints.
- [ ] `write-loop-idle-watchdog.test.ts` "a silent agent settles idle_output_timeout well before the iteration wall elapses" (`/fake` worktree, line 87) stays green (preserved `no_git` negative path).
- [ ] `write-loop.test.ts` `no-binding-checkpoint-skip` and `iteration_commit event distinguishes committed, no_file_changes, and no_git skips` stay green (preserved skip-kind negative anchors).
- [ ] `v2/docs/write-behavior.md` reconciles existing terminal-settlement prose so unconditional non-resumable idle-timeout language does not contradict conditional settlement; documents fresh-commit versus skipped-checkpoint `idle_output_timeout` resumability, failed settlement semantics unchanged, and interim daemon limbo until resume-admission.
- [ ] `v2/docs/v1-behaviors.md` records the write-loop settlement contract change (`loop_finished` conditional resumability) without claiming daemon resume admission already works.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — reconcile terminal-settlement prose; fresh-commit versus skipped-checkpoint `idle_output_timeout` resumability; interim limbo (write-loop signal vs daemon admission).
- `v2/docs/v1-behaviors.md` — write-loop settlement contract only; daemon resume unchanged until resume-admission.
- `v2/docs/workflow-runner.md` — stale until `idle-timeout-resume-admission` merges; add interim-limbo cross-reference only, do not claim daemon resume works.
