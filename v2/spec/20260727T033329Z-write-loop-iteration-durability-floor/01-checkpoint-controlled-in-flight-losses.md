# 01 - Checkpoint controlled in-flight losses

## Problem

Abort and watchdog races currently leave the loop before an agent invocation has
quiesced or its edits have been checkpointed. A daemon kill acknowledgement can
therefore precede durable agent work.

## Decisions

- The floor applies only after the aborted or watchdog-cancelled invocation has
  settled and can no longer mutate the worktree. Abrupt daemon or process death
  remains outside the floor.
- A daemon kill acknowledgement only records/accepts the kill; durability is
  guaranteed after write-loop settlement, not at acknowledgement. The kill
  test waits for that settlement.
- On abort/kill, checkpoint after invocation quiescence and before loop
  settlement. On watchdog expiry, checkpoint after quiescence and before the
  `iteration_timeout` boundary.
- An in-flight checkpoint uses the last-started binding, including a fallback
  attempt interrupted after an earlier fallback failure: its metadata title
  (or creation-title fallback) and `Jarvis-Agent:` trailer identify that
  interrupted attempt.
- A checkpoint failure before an unpersisted watchdog timeout is authoritative:
  persist failed, resumable `iteration_commit_failed`, not `iteration_timeout`;
  do not publish; resume retries the write path. If kill state is already
  persisted, kill remains authoritative and resumable, no later attempt
  boundary is written or publication started, and the checkpoint error is
  retained in the run log for resume diagnostics.
- Ready-gate repair iterations are excluded from this durability floor. Their
  existing post-publication recommit behavior is unchanged; docs must not call
  them covered write-loop iterations.

## Task checklist

- [x] Wait for cancellation quiescence before checkpointing controlled losses.
- [x] Checkpoint abort/kill and watchdog losses with interrupted-binding attribution.
- [x] Preserve kill-state, watchdog failure, terminal publication, and existing progress-path behavior.
- [x] Add focused real-git loss-path, attribution, ordering, failure-precedence, and inversion coverage in `v2/src/execution/write-loop.test.ts`.
- [x] Complete the documentation updates below.

## Acceptance criteria

- [x] `v2/src/execution/write-loop.test.ts` test `mid-iteration kill commits agent edits before settle` drives a daemon kill after an agent writes but before it returns, waits for write-loop settlement, and proves the written paths and contents are in `base..HEAD`, with no post-quiescence dirty paths; it fails against the pre-fix code.
- [x] `v2/src/execution/write-loop.test.ts` test `iteration watchdog checkpoints quiesced agent edits before timeout settlement` writes before watchdog cancellation, proves no late write remains dirty after quiescence, and orders `iteration_commit` before `boundary_committed(iteration_timeout)`; it fails against the pre-fix code.
- [x] `v2/src/execution/write-loop.test.ts` test `kill checkpoint precedes loop settlement` orders the quiesced-loss checkpoint before `loop_finished` while preserving the already-persisted killed status; it fails against the pre-fix code.
- [x] `v2/src/execution/write-loop.test.ts` test `interrupted fallback checkpoint attributes the active binding` fails one binding, kills the fallback after it writes, and proves the checkpoint subject and `Jarvis-Agent:` trailer belong to that fallback; it fails against the pre-fix code.
- [x] `v2/src/execution/write-loop.test.ts` test `watchdog checkpoint failure supersedes timeout boundary` proves a committer error persists resumable `iteration_commit_failed`, suppresses `iteration_timeout` and publication, and resumes through the write path; it fails against the pre-fix code.
- [x] `v2/src/execution/write-loop.test.ts` test `kill checkpoint failure preserves killed state` proves a post-ack checkpoint error neither overwrites the killed state nor starts publication, and is visible to resume diagnostics; it fails against the pre-fix code.
- [x] Disabling or inverting the abort/kill trigger turns `mid-iteration kill commits agent edits before settle` and `kill checkpoint precedes loop settlement` red; disabling or inverting the watchdog trigger turns `iteration watchdog checkpoints quiesced agent edits before timeout settlement` red.
- [x] Durability coverage includes killed/aborted and watchdog runs; no test claims the floor from a successfully completed run alone.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — replace the `progress`-only contract with main-loop settled-boundary and controlled-loss timing; distinguish settled outcomes, abort/kill acknowledgement versus settlement, `iteration_timeout`, checkpoint-failure precedence, excluded ready repairs, and abrupt process death; retain terminal publication semantics.
- `v2/docs/operator-runbook.md` § Orphaned non-terminal runs after daemon restart — replace the `progress`-only warning with the eventual-settlement floor, the kill-ack limit, excluded ready repairs, and abrupt-process-death limit.
- `v2/docs/v1-behaviors.md` — update per-iteration cadence for git-backed main-loop write steps, including `publishCompletion: false`; do not claim ready repairs or abrupt process death receive the floor.
