# Reject repair extensions to `LOAD_SENSITIVE_FILES`

Ready-gate repair on PR #2243 grew `LOAD_SENSITIVE_FILES` to green a red gate — an operator-level
suite execution policy change that must not ride repair completion.

## Decisions

- Extract membership as the set of string literals in the `LOAD_SENSITIVE_FILES` array binding in
  `scripts/test-slice.ts` at `<baseRef>` vs the staged worktree copy — not full TypeScript semantics;
  reorder and comment-only churn that leaves literal membership unchanged pass this guard.
- Reject repair completion when staged membership is a strict superset of base membership — only
  additions fail; removals are permitted.
- Run the membership guard inside `validateReadyGateRepairCompletion` (shared by first repair and
  persisted-fence recovery) and fail as retryable `completion_commit_failed` — rules out a distinct
  failure kind or post-publish check.
- Dedicated test invert `invertReadyGateRepairLoadSensitiveGuardForTest` disables only the membership
  guard; `invertReadyGateRepairFenceForTest` does not — rules out one flag coupling both guards.
- Non-growing edits to `scripts/test-slice.ts` remain subject only to the ordinary run-diff path
  fence — rules out banning all module edits when the run legitimately touched it.

## Work

- Add membership extraction and superset check to `validateReadyGateRepairCompletion`.
- Extend `v2/src/execution/write-loop.test.ts` ready-gate repair fence coverage for rejection,
  benign churn, non-growing allowance, and the dedicated invert seam.
- Document operator policy and fence behavior in the durable homes below.

## Acceptance criteria

- [x] `v2/src/execution/write-loop.test.ts` test `rejects ready-gate repairs that extend
      LOAD_SENSITIVE_FILES` stages a new explicit-list entry, returns `completion_commit_failed`
      before repair republish, and fails against the pre-fix baseline.
- [x] Inverting `invertReadyGateRepairLoadSensitiveGuardForTest` makes that regression red; with
      only `invertReadyGateRepairFenceForTest` enabled the membership guard still rejects extension.
- [x] `write-loop.test.ts` test `allows ready-gate repairs that edit test-slice without growing
      LOAD_SENSITIVE_FILES` has `scripts/test-slice.ts` in the frozen run-diff allowset, stages a
      non-growing edit (comment-only or literal reorder), repair completes without
      `completion_commit_failed`, and fails against the pre-fix baseline.
- [x] `v2/docs/test-writing.md` states explicit `LOAD_SENSITIVE_FILES` changes are operator
      decisions, not repair-time.
- [x] `v2/docs/write-behavior.md` documents the load-sensitive membership guard on ready-gate repair
      completion.
- [x] `v2/docs/v1-behaviors.md` ready-gate repair fencing bullet includes the membership guard.

## Documentation updates

- `v2/docs/test-writing.md` — explicit-list changes are operator decisions, not repair-time.
- `v2/docs/write-behavior.md` — load-sensitive membership guard on ready-gate repair completion.
- `v2/docs/v1-behaviors.md` — extend the ready-gate repair fencing bullet with the membership
  guard.
