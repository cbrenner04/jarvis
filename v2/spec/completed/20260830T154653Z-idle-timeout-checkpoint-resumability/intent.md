---
name: idle-timeout-checkpoint-resumability
---

# Derive idle-timeout resumability from its boundary checkpoint

## Problem

The write loop checkpoints a stalled iteration before settling `idle_output_timeout`, but it always returns and logs `resumable: false`, discarding the distinction between a fresh iteration commit and `no_file_changes`.

## Decisions

- Set `idle_output_timeout` `resumable: true` only when that attempt's boundary checkpoint produced a fresh `iteration_commit` with `commitSha` — rules out treating an older commit or a skipped checkpoint as recoverable progress.
- Keep `idle_output_timeout` `resumable: false` when its checkpoint reports `no_file_changes`, `no_git`, or `no_binding` — rules out reviving an empty or uncheckpointed stall.
- Preserve `runStatus: "failed"` and `outcomeKind: "idle_output_timeout"` in both cases — rules out conflating resumability with successful completion or `iteration_timeout`.

## Prerequisites

- Every settled git-backed write-loop iteration checkpoints before its SQLite boundary and emits `iteration_commit` with either a fresh `commitSha` or a skip reason.
- A settled write-step stall maps to failed `idle_output_timeout` after the checkpoint.

## Acceptance criteria

- [ ] `write-loop-idle-watchdog.test.ts` drives a stalled iteration that writes a tracked file, asserts its boundary emits `iteration_commit` with `commitSha`, then asserts the returned result and terminal `loop_finished` are `idle_output_timeout` with `resumable: true`; it fails against the baseline hard `false`.
- [ ] The committed-progress regression test fails when the production fresh-checkpoint resumability guard is manually replaced with `false` at the source, and passes on the real guard; no production inversion hook is added.
- [ ] `write-loop-idle-watchdog.test.ts` drives a stalled iteration with no file changes and asserts `iteration_commit.skipReason: "no_file_changes"` plus `resumable: false` on the result and terminal `loop_finished`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — committed-progress versus skipped-checkpoint `idle_output_timeout` resumability.
- `v2/docs/v1-behaviors.md` — record the changed write-loop settlement contract.
