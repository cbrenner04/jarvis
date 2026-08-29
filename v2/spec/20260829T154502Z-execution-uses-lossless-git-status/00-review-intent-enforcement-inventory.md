# Use the shared inventory for reviewed-intent enforcement

## Problem

Reviewed-intent boundary enforcement parses porcelain itself, risking lossy path handling independently of the shared Git contract.

## Decisions

- Derive Git-backed changed paths from `getGitStatusInventory` and each entry's exact `currentPath`; rename/copy origin paths remain excluded.
- Retain the filesystem snapshot fallback and fail-closed Git-inspection failure reporting.
- Preserve boundary allowlists and restoration after the current-path projection.

## Tasks

- Migrate `v2/src/execution/review-intent-enforcement.ts` from its local porcelain parser to the shared typed inventory.
- Add the lossless-path and inspection-failure pins in `review-intent-enforcement.test.ts`, including a source `// @mutate` directive in the lossless-path test.
- Update `v2/docs/workflow-runner.md` with reviewed-intent enforcement's shared lossless inventory boundary.

## Acceptance criteria

- [ ] `v2/src/execution/review-intent-enforcement.ts` obtains Git-backed changed paths through `getGitStatusInventory`, projects only exact `currentPath` values, and contains no independent porcelain parser.
- [ ] `review-intent-enforcement.test.ts` test `git-enabled: getChangedPaths preserves lossless status paths` proves spaces, newlines, non-ASCII text, and leading/trailing whitespace reach the reviewed-intent changed-path set unchanged; it fails against the pre-fix parser.
- [ ] `review-intent-enforcement.test.ts` test `git-enabled: getChangedPaths reports shared-inventory inspection failure` pins the existing fail-closed inspection-error result, while `git-disabled: restoreWorkingTree discards unauthorized changes` stays green for the filesystem fallback.
- [ ] `review-intent-enforcement.test.ts` — `git-enabled: getChangedPaths preserves lossless status paths`; Mutation checkpoint: the test body carries a source `// @mutate` directive that makes the migrated current-path projection lossy, and the scoped test turns RED under that mutation.
- [ ] `v2/docs/workflow-runner.md` documents that reviewed-intent boundary enforcement consumes the shared lossless inventory, projects current paths only, and retains its inspection-error and fallback behavior.

## Documentation updates

- `v2/docs/workflow-runner.md` — reviewed-intent boundary enforcement through the shared lossless inventory.
