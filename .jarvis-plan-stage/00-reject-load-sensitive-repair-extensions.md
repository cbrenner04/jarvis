# Reject repair extensions to `LOAD_SENSITIVE_FILES`

Ready-gate repair on PR #2243 grew `LOAD_SENSITIVE_FILES` to green a red gate — an operator-level
suite execution policy change that must not ride repair completion.

## Decisions

- Reject repair completion when staged `scripts/test-slice.ts` would add any path to
  `LOAD_SENSITIVE_FILES` relative to `<baseRef>` — rules out repair-time load-sensitivity
  relaxation.
- Compare only set membership of `LOAD_SENSITIVE_FILES` string entries; reordering or comment-only
  edits that leave membership unchanged pass this guard — rules out failing benign formatting churn.
- Non-growing edits to `scripts/test-slice.ts` remain subject only to the ordinary run-diff path
  fence — rules out banning all module edits when the run legitimately touched it.
- Run the guard in the same repair-completion validation hook as the path fence (including persisted
  fence recovery) and fail as retryable `completion_commit_failed` — rules out a distinct failure
  kind or post-publish check.

## Work

- Add a repair-completion guard that diffs `LOAD_SENSITIVE_FILES` membership at `<baseRef>` against
  the staged worktree copy of `scripts/test-slice.ts`.
- Extend `v2/src/execution/write-loop.test.ts` ready-gate repair fence coverage for rejection,
  non-growing allowance, and invert seam.
- Document operator policy and fence behavior in the durable homes below.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts` test `rejects ready-gate repairs that extend
      LOAD_SENSITIVE_FILES` stages a new explicit-list entry, returns `completion_commit_failed`
      before repair republish, and fails against the pre-fix baseline.
- [ ] Inverting the load-sensitive guard makes that regression red.
- [ ] `write-loop.test.ts` proves a repair that edits `scripts/test-slice.ts` without growing
      `LOAD_SENSITIVE_FILES` still completes when the path is in the frozen allowset.

## Documentation updates

- `v2/docs/test-writing.md` — explicit-list changes are operator decisions, not repair-time.
- `v2/docs/write-behavior.md` — load-sensitive membership guard on ready-gate repair completion.
- `v2/docs/v1-behaviors.md` — extend the ready-gate repair fencing bullet with the membership
  guard.
