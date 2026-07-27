# Let non-Git husks reach materialization

## Problem

Incomplete workflow re-dispatch refuses before materialization when its managed path is an ordinary non-Git directory, leaving no applicable automated recovery.

## Decisions

- Classify only a `git status` error containing Git's `not a git repository` diagnostic as a managed-path husk; rules out treating missing paths, permission errors, or arbitrary subprocess failures as husks.
- Return from stale reset without retirement mutations for that husk and continue dispatch to existing locked materialization; rules out deleting the directory in preflight without the materializer's registration and ownership checks.
- Preserve the current listing-error refusal and recovery text for every other `git status` failure, including when `--reset-despite-dirty` is set; rules out weakening the fail-closed gate or broadening the override.
- Reuse the fixture's surviving branch at its captured initial `HEAD`; fresh-branch and `--base` behavior are out of scope.

## Task checklist

- [ ] Narrow the stale-reset dirty-listing classification so a managed-path non-Git diagnostic defers to workflow materialization.
- [ ] Add connected implement and plan re-dispatch coverage, with and without `--reset-despite-dirty`, for a non-Git husk and materializer safety boundaries.
- [ ] Add focused refusal coverage for a different status failure under both override states.
- [ ] Update the operator runbook and v1 behavior catalog.

## Acceptance criteria

- [ ] `v2/src/commands/workflow.test.ts` connected re-dispatch coverage drives incomplete `implement` and `plan` workflows, each with and without `--reset-despite-dirty`, through locked materialization from an ordinary non-Git directory at the managed path to the write callback. It proves preflight performs no retirement, the materializer replaces the husk, and the checkout is the fixture's surviving branch at its captured initial `HEAD`; it fails against the pre-fix `not a git repository` refusal.
- [ ] `v2/src/commands/workflow.test.ts` connected re-dispatch coverage proves a registered non-Git managed path and an inconclusive materializer probe both refuse without deleting their residue. `v2/src/execution/external-worktree.test.ts` tests `refuses a registered non-Git directory and leaves it intact`, `refuses an ambiguous Git-worktree probe and leaves the path intact`, and `refuses an inconclusive worktree-registration probe and leaves the path intact` stay green.
- [ ] `v2/src/commands/cleanup.test.ts` test `reset refuses fail-closed when dirty listing fails` proves a non-missing-repository status error still refuses with the existing recovery text and no retirement mutations both with and without `--reset-despite-dirty`.
- [ ] Guard inversion: the connected workflow and cleanup tests fail if the missing-repository classifier is removed or widened to accept the other status failure; the workflow safety cases fail if registered or inconclusive paths are reclaimed.
- [ ] `v2/src/commands/cleanup.test.ts` tests `reset refuses when worktree has uncommitted tracked changes`, `reset refuses when worktree has untracked paths`, and `staleResetDirtyWorktreeGateReason refuses dirty paths and skips dirty refusal only when overridden` stay green.
- [ ] `v2/docs/operator-runbook.md` records that incomplete implement and plan re-dispatch defer a non-Git managed-path husk to locked materialization regardless of `--reset-despite-dirty`, while other listing failures still refuse.
- [ ] `v2/docs/v1-behaviors.md` records the narrowed stale-reset preflight classification and source paths.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — update incomplete re-run recovery and Worktrees and branches with automatic husk handling before materialization for implement and plan, unchanged override classification, and retained fail-closed cases.
- `v2/docs/v1-behaviors.md` — update incomplete implement/plan re-run stale reset with the non-Git managed-path exception.
