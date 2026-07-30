# Exclude harness sidecars from ready-gate repair completion

Ready-gate repair must not commit or republish harness sidecars whose basename matches
`.jarvis-*` (for example `.jarvis-intent-review-verdict.md` and
`.jarvis-intent-review-verdict.md.owner`). Nested paths under a `.jarvis-*` directory whose
own basenames are ordinary (e.g. `.jarvis-plan-stage/intent.md`) are out of scope.

## Serial dependency

This spec extends `validateReadyGateRepairCompletion` and must land before sibling intents
`ready-gate-repair-cannot-extend-load-sensitive-files` and
`markdown-only-workflow-ready-repair-rejects-code-edits` are planned or run.

## Decisions

- **Predicate:** a candidate violates when its basename matches `.jarvis-*`; use this
  predicate for rejection and for post-repair non-publication assertions (not a full-path
  glob).
- **Published tree:** paths introduced by repair-completion commits on the branch — same
  meaning as existing ready-gate repair fence tests (`completion_commit_failed` plus no
  second publish).
- Reject basename violations on the same `validateReadyGateRepairCompletion` seam as the
  frozen allowset fence — rules out post-commit stripping, gitignore-only exclusion, or a
  separate commit hook.
- Run the basename check before the allowset membership check; among multiple basename
  violations, report the first by normalized repository-relative byte order — rules out
  nondeterministic first-offender evidence when both violation kinds appear.
- Fail as retryable `completion_commit_failed` with a basename-specific message naming
  the normalized sidecar path — rules out reusing the allowset fence message (which would
  falsely claim the path is outside the run diff and spec tree) and silently dropping
  sidecars while committing the rest.
- Cover `.jarvis-intent-review-verdict.md` and its `.owner` sidecar in the negative
  regression — rules out a hardcoded filename list that omits the `.owner` suffix pattern.

## Work

- Extend repair-fence candidate validation to reject `.jarvis-*` basenames before allowset
  membership.
- Add a basename-scoped test inversion seam (separate from `invertReadyGateRepairFenceForTest`).
- Add `write-loop.test.ts` coverage under the existing `ready-gate repair fence` describe
  block for rejection, guard inversion, and post-repair tree assertions.
- Recovery, retry, and review-mutation repair routes inherit the shared validator
  intentionally — no duplicate ACs.
- Document harness-sidecar exclusion in operator-facing write behavior and the v1 parity
  catalog entry for ready-gate repair fencing.

## Acceptance criteria

- [ ] `write-loop.test.ts` test `rejects ready-gate repairs that would publish harness
      sidecars` seeds `.jarvis-intent-review-verdict.md` (and `.owner`) as allowset members
      before the fence freezes (committed in the run diff or under the resolved spec tree),
      stages those paths as repair-completion candidates, returns `completion_commit_failed`
      before repair republish with a basename-specific message naming the first offending
      sidecar by normalized path, asserts the published tree contains no candidate whose
      basename matches `.jarvis-*`, and fails against the pre-fix baseline.
- [ ] Inverting the basename-scoped test seam in that regression turns it RED
      (`invertReadyGateRepairFenceForTest` is insufficient).
- [ ] `write-loop.test.ts` tests `completes repair limited to an existing run-diff path`
      and `completes repair limited to the resolved spec tree` stay green.
- [ ] `v2/docs/write-behavior.md` documents that ready-gate repair completion rejects
      `.jarvis-*` basename harness sidecars before commit or republish.
- [ ] `v2/docs/v1-behaviors.md` ready-gate repair fencing entry records the `.jarvis-*`
      sidecar exclusion.

## Documentation updates

- `v2/docs/write-behavior.md` — harness sidecars excluded from repair commits.
- `v2/docs/v1-behaviors.md` — extend ready-gate repair fencing with `.jarvis-*` exclusion.
