# Preserve lossless dirty-worktree completion diagnostics

## Problem

`getUncommittedPaths` parses collapsed porcelain output, so terminal completion can omit a nested untracked file and callers cannot share one explicit fail-soft inventory contract.

## Decisions

- `getUncommittedPaths` projects exact current paths from `getGitStatusInventory`, excludes only the materialized `node_modules` path, and returns `[]` when Git inspection fails or status framing is malformed.
- A terminal no-SHA result fails only when successful inventory finds a non-excluded path; a fail-soft empty result retains the existing non-diagnostic behavior.
- `v2/src/execution/write-loop.ts` terminal and ready-gate snapshot/restoration call sites, plus `v2/src/execution/workflow-runner.ts` completion and resume call sites, share this contract without a new ordering or diagnostic-serialization guarantee.

## Tasks

- Migrate `getUncommittedPaths` in `v2/src/execution/write-loop.ts` to the shared typed inventory and remove its local porcelain parser.
- Add real-Git nested-untracked, unusual-path diagnostic, fail-soft inspection, ready-gate snapshot/restoration, and workflow completion/resume pins to `write-loop.test.ts` and `workflow-runner-publication.test.ts`.
- Place the headline-revert and no-SHA-guard source `// @mutate` directives inside the named terminal-completion test.
- Update `v2/docs/v1-behaviors.md` with nested-untracked completion-gate behavior, fail-soft inspection qualification, and the migrated execution sources.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.ts` obtains `getUncommittedPaths` from `getGitStatusInventory`, retains only the materialized `node_modules` exclusion, and contains no independent porcelain parser.
- [ ] `write-loop.test.ts` test `terminal completion reports the nested untracked file` uses a real Git fixture whose only dirt is a file inside an untracked directory, settles `completion_commit_failed` when the committer returns no SHA, and names that nested file rather than its parent directory; it fails against the pre-fix parser.
- [ ] `write-loop.test.ts` test `terminal completion reports the nested untracked file` proves each path containing spaces, newlines, non-ASCII text, or leading/trailing whitespace reaches terminal diagnostics unchanged as an exact path value; it makes no ordering, delimiter, or recoverable-serialization claim.
- [ ] `write-loop.test.ts` test `getUncommittedPaths is fail-soft for Git failure and malformed status framing` pins `[]` for both cases, and `shouldFailTerminalCompletionForDirtyWorktree rejects complete when dirty after no-op committer (inverted guard would complete)` stays green for successful non-empty inventory.
- [ ] `write-loop.test.ts` test `ready-gate snapshot and restoration retain lossless uncommitted paths` pins the same exact filtered-path contract at ready-gate snapshot/restoration, and `workflow-runner-publication.test.ts` test `workflow completion and resume retain the fail-soft uncommitted-path contract` pins it for workflow completion and resume callers.
- [ ] `write-loop.test.ts` — `terminal completion reports the nested untracked file`; Keystone checkpoint: the test body carries a source `// @mutate` directive that restores collapsed-directory projection at the migrated `getUncommittedPaths` inventory boundary, and the scoped test turns RED under that mutation.
- [ ] `write-loop.test.ts` — `terminal completion reports the nested untracked file`; Mutation checkpoint: the test body carries a source `// @mutate` directive that bypasses the no-SHA dirty-worktree failure guard, and the scoped test turns RED under that mutation.
- [ ] `write-loop.test.ts` test `uncommitted paths omit the materialized node_modules symlink and keep other untracked work` stays green; other inventory paths retain the named caller contracts above.
- [ ] `v2/docs/v1-behaviors.md` records nested-untracked completion diagnostics, the conditional no-SHA dirty failure, fail-soft Git or malformed-status inspection, and the migrated execution sources.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — nested-untracked completion-gate behavior and migrated execution sources.
