# 00 - Checkpoint settled write iterations

## Problem

`v2/src/execution/write-loop.ts` checkpoints only `progress` results. A
single-iteration implement step normally settles `done`, while other terminal
and failure-like results also bypass the checkpoint before their SQLite boundary.

## Decisions

- Checkpoint every git-backed settled main-loop iteration before its SQLite
  boundary; rules out `progress`-only durability and post-boundary commits.
- Covered settled results are `progress`, `complete` (`done` and `no-work`),
  `blocked`, `contract_miss`, `invalid_token`, `missing_blocker`,
  `invocation_failure`, and `stall` (`idle_output_timeout`).
- Preserve each real step outcome and terminal mapping; rules out fabricating `progress` to reach the commit hook.
- A `contract_miss` blocker append occurs before this checkpoint and belongs in
  its snapshot; rules out a durable outcome with a dirty harness-written blocker.
- Reuse the existing `iteration_commit`/skip event and fail-closed
  `iteration_commit_failed` result; rules out parallel telemetry or best-effort
  commit failures.
- Preserve current `.git`-absent and no-file-change skips plus commit title, `Spec:`, and `Jarvis-Agent:` contracts; rules out empty or unattributed checkpoint commits.
- Keep the distinct terminal completion commit as the sole publication input; rules out pushing or publishing checkpoint commits at non-terminal boundaries.
- Ready-gate repair iterations are excluded: they retain their existing
  publish/recommit behavior and do not receive this floor. The implementation
  and docs must say the floor covers main-loop write iterations only.
- If a settled checkpoint fails, it is authoritative: persist a failed,
  resumable `iteration_commit_failed` boundary for that attempt instead of the
  candidate terminal boundary, do not publish, and require resume to retry the
  write path rather than publish the uncheckpointed result.

## Task checklist

- [ ] Generalize the iteration checkpoint seam and `iteration_commit` contract beyond `progress`.
- [ ] Checkpoint every listed settled result before its durable boundary, including harness-written contract-miss blockers.
- [ ] Preserve terminal completion publication and current progress-path ordering, skip classification, and failure handling.
- [ ] Add focused real-git settled-result and inversion coverage in `v2/src/execution/write-loop.test.ts`.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts` test `single-iteration done without progress emits iteration_commit` asserts a `done` run that never returns `progress` emits an iteration commit, then `boundary_committed`, then its distinct completion commit; it fails against the pre-fix code.
- [ ] `v2/src/execution/write-loop.test.ts` parameterized test `settled result classes checkpoint before their boundary` covers `no-work`, `blocked`, `invalid_token`, `missing_blocker`, `invocation_failure`, and `idle_output_timeout`, and asserts each checkpoint precedes its matching `boundary_committed`; it fails against the pre-fix code.
- [ ] `v2/src/execution/write-loop.test.ts` test `contract-miss blocker is included in its settled checkpoint` proves the appended blocker and agent edit are in the checkpoint tree before the `contract_miss` boundary; it fails against the pre-fix code.
- [ ] `v2/src/execution/write-loop.test.ts` test `settled checkpoint failure supersedes terminal boundary and publication` proves a committer error persists resumable `iteration_commit_failed`, does not persist the candidate terminal boundary or publish, and resumes through the write path; it fails against the pre-fix code.
- [ ] Disabling or inverting the settled-result trigger turns `single-iteration done without progress emits iteration_commit` and `settled result classes checkpoint before their boundary` red.
- [ ] `v2/src/execution/write-loop.test.ts` `describe("per-iteration git commit on progress")`, including `terminal completion adds a third sha after two iteration commits and attribution lists all` and `iteration_commit event distinguishes committed, no_file_changes, and no_git skips`, stays green.
- [ ] `v2/src/execution/write-loop.test.ts` keeps ready-repair tests green without asserting they have a checkpoint floor.
