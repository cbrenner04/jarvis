# External and empty spec scopes derive an allowset

## Problem

`enumerateSpecTreePaths` (`v2/src/execution/ready-finalize.ts`) returns `null` for an existing out-of-worktree spec dir (`relative(worktreePath, file)` yields `../` paths `validateRepoRelativePath` rejects; the `scopeRoot === null` fallback is unreachable) and for an existing scope root with no Markdown files (`files.length === 0`). Either makes `deriveGateAllowedPaths` return `undefined` (#3423, #4004).

## Decisions

- Out-of-worktree roots contribute zero spec paths: no repo-relative form exists for a directory outside the worktree, so resolving relative to the scope root would still fail `validateRepoRelativePath`.
- The `normalizePublicationSpecPath` fallback is not used for out-of-worktree roots. `normalizePublicationSpecPath` returns the absolute `specPath` unchanged when it is `..`-relative to the worktree (`v2/src/execution/publication-spec-path.ts:5-11`), and `validateRepoRelativePath` still rejects an absolute path — the fallback cannot produce a value either.
- Out-of-repo spec files can never appear in gate failure paths, so dropping them from the allowset is safe: `classifyReadyGateFailure` only matches `failingPaths` against the allowset (`v2/src/execution/ready-finalize.ts:707-713`), and `failingPaths` comes from `FAILING_TEST_FILE_MARKER` records emitted for the repo-relative test files passed into `runV2TestFiles` (`scripts/run-v2-tests.ts:190-193`) — never spec-tree files.
- `resolveSpecScopeRoot` reports whether the resolved root is inside the worktree via a lexical `relative(worktreePath, root)` prefix check (string comparison, no `realpath`), computed on the final resolved root — after the `.md`-file `dirname` step when `specPath` names a file; rules out an existing external dir silently bypassing the out-of-worktree branch.
- A missing external `specPath` (resolved root doesn't exist as a directory or `.md` file) stays a failure, same as a missing in-worktree root; rules out fail-open on either side of the inside/outside split.
- An existing in-worktree scope root with no Markdown files contributes zero spec paths; rules out `files.length === 0` → `null`.
- A missing in-worktree scope root stays a failure; rules out widening fail-open beyond the two reported cases.

## Tasks

- [ ] Return `{ root: string; insideWorktree: boolean } | null` from `resolveSpecScopeRoot`; export it for direct testing of the flag.
- [ ] `enumerateSpecTreePaths`: `insideWorktree: false` → `[]`; root missing → `null`; existing inside root with no Markdown → `[]`.
- [ ] Add `ready-finalize.test.ts` cases over real temp dirs (no `listSpecTreePaths` seam): external existing dir with Markdown, external missing dir, in-worktree empty dir, in-worktree missing dir.

## Acceptance criteria

- [ ] A `ready-finalize.test.ts` test proves `deriveGateAllowedPaths` returns a non-empty allowset (diff/untracked paths) for an absolute `specPath` directory that exists outside the worktree and contains Markdown; it fails against the pre-fix `..`-rejection returning `undefined`.
- [ ] A `ready-finalize.test.ts` test proves derivation returns an allowset (not `undefined`) when the resolved in-worktree scope root exists with no Markdown files; it fails against the pre-fix `files.length === 0` → `null`.
- [ ] A `ready-finalize.test.ts` test asserts `resolveSpecScopeRoot` reports `insideWorktree: false` for the external directory above, and the `deriveGateAllowedPaths` allowset for that case contains no absolute or `..`-prefixed paths while still containing the run's diff/untracked paths; it fails against the pre-fix code, where the out-of-worktree branch is unreachable.
- [ ] A `ready-finalize.test.ts` test proves `deriveGateAllowedPaths` returns `undefined` when the resolved scope root does not exist, both for an in-worktree `specPath` and for an absolute out-of-worktree `specPath`; guards the missing-root branches against being loosened to fail-open.
- [ ] Existing `deriveGateAllowedPaths` cases in `v2/src/execution/ready-finalize.test.ts` and `v2/src/execution/write-loop.test.ts` stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — allowset derivation: external spec home contributes no spec paths; empty scope root yields an empty spec set.
- `v2/docs/v1-behaviors.md` — record external-spec-home and empty-scope allowset derivation.
