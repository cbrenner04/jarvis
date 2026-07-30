# Exclude harness sidecars from ready-gate repair completion

Ready-gate repair must not commit or republish local harness sidecars whose basename
matches `.jarvis-*` (for example `.jarvis-intent-review-verdict.md` and
`.jarvis-intent-review-verdict.md.owner`).

## Decisions

- Reject any repair-completion candidate whose basename matches `.jarvis-*` on the same
  `validateReadyGateRepairCompletion` seam as the frozen allowset fence — rules out
  post-commit stripping, gitignore-only exclusion, or a separate commit hook.
- Apply the basename rule unconditionally, before or alongside allowset membership — rules
  out relying on run-diff/spec-tree allowlisting to exclude sidecars that happen to be
  in scope.
- Fail as retryable `completion_commit_failed` naming the normalized sidecar path — rules
  out silently dropping sidecars from the staged candidate set while committing the rest.
- Cover `.jarvis-intent-review-verdict.md` and its `.owner` sidecar in the negative
  regression — rules out a hardcoded filename list that omits the `.owner` suffix pattern.

## Work

- Extend repair-fence candidate validation to reject `.jarvis-*` basenames.
- Add `write-loop.test.ts` coverage under the existing `ready-gate repair fence`
  describe block for rejection, guard inversion, and post-repair tree assertions.
- Document harness-sidecar exclusion in operator-facing write behavior and the v1 parity
  catalog entry for ready-gate repair fencing.

## Acceptance criteria

- [ ] `write-loop.test.ts` test `rejects ready-gate repairs that would publish harness
      sidecars` leaves a `.jarvis-intent-review-verdict.md` (and `.owner`) in the worktree,
      returns `completion_commit_failed` before repair republish, names the sidecar path,
      asserts the post-repair published tree excludes every `.jarvis-*` path, and fails
      against the pre-fix baseline.
- [ ] Inverting the `.jarvis-*` basename guard in that regression turns it RED.
- [ ] `write-loop.test.ts` tests `completes repair limited to an existing run-diff path`
      and `completes repair limited to the resolved spec tree` stay green.
- [ ] `v2/docs/write-behavior.md` documents that ready-gate repair completion rejects
      `.jarvis-*` harness sidecars before commit or republish.
- [ ] `v2/docs/v1-behaviors.md` ready-gate repair fencing entry records the `.jarvis-*`
      sidecar exclusion.

## Documentation updates

- `v2/docs/write-behavior.md` — harness sidecars excluded from repair commits.
- `v2/docs/v1-behaviors.md` — extend ready-gate repair fencing with `.jarvis-*` exclusion.
