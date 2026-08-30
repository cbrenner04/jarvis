# Migrate stale-reset dirty listing

## Problem

`listDirtyWorktreePathsForStaleReset` (`v2/src/commands/cleanup.ts`) is the last independent `git status` porcelain path parser in v2 path-aware consumers. Newline splitting, status-prefix slicing, rename-arrow parsing, and `.trim()` on path text can mangle valid rename destinations and whitespace-bearing or non-ASCII names in stale-reset dirty refusal diagnostics.

## Decision ledger

- Derive stale-reset dirty paths from `getGitStatusInventory` typed entries and each entry's exact `currentPath`; rules out retaining newline-delimited `git status --porcelain` parsing, `line.slice(3)`, rename-arrow slicing, or path `.trim()` in this seam.
- Apply harness-sidecar and materialized `node_modules` exclusions from typed `untracked` status and exact `currentPath` fields; rules out re-deriving untracked state from raw status-prefix characters.
- Preserve fail-closed non-empty-status behavior: malformed or unrecognized inventory that still yields blocking entries refuses as dirty, and listing errors still refuse without retirement; rules out treating unparseable inventory as clean.
- Preserve clean, dirty, not-a-repository, and listing-error `DirtyWorktreeListResult` outcomes and `staleResetDirtyWorktreeGateReason` copy; rules out changing gate ordering or recovery strings in this slice.
- Rename the headline lossless-path pin from `reports porcelain paths` to `reports lossless status paths`; rules out leaving the pre-fix test name that documents the old parser contract.

## Tasks

- Migrate `listDirtyWorktreePathsForStaleReset` to `getGitStatusInventory` and remove its local porcelain status parser and `isUntrackedPorcelainLine` helper when no longer referenced.
- Extend `cleanup.test.ts` with a real-Git lossless-path pin covering rename destinations plus spaces, newlines, non-ASCII text, and leading or trailing whitespace.
- Add a harness-sidecar exclusion pin when no existing `cleanup.test.ts` case covers untracked `.jarvis-*` paths alone yielding clean status.
- Update stale-reset operator and parity docs for exact lossless dirty-path diagnostics while retaining harness-sidecar and materialized `node_modules` exclusions.

## Acceptance criteria

- [ ] `v2/src/commands/cleanup.ts` obtains stale-reset dirty paths through `getGitStatusInventory`, projects only exact `currentPath` values for blocking entries, and contains no independent `git status` porcelain path parser in `listDirtyWorktreePathsForStaleReset`.
- [ ] `cleanup.test.ts` test `listDirtyWorktreePathsForStaleReset reports lossless status paths` proves rename destinations and paths containing spaces, newlines, non-ASCII text, or leading or trailing whitespace reach `DirtyWorktreeListResult.paths` unchanged; it fails against the pre-fix newline porcelain parser.
- [ ] `cleanup.test.ts` test `listDirtyWorktreePathsForStaleReset ignores untracked harness sidecars` proves a worktree holding only untracked `.jarvis-*` paths yields `{ status: "clean" }`; it fails against the pre-fix parser when sidecar filtering is removed.
- [ ] `cleanup.test.ts` test `listDirtyWorktreePathsForStaleReset treats non-empty unparseable porcelain as dirty` stays green.
- [ ] `cleanup.test.ts` test `listDirtyWorktreePathsForStaleReset ignores a worktree holding only the materialized node_modules symlink` proves a worktree holding only the materialized worktree-root `node_modules` symlink yields `{ status: "clean" }`; it fails against the pre-fix parser when the materialized `node_modules` exclusion is removed.
- [ ] `v2/docs/operator-runbook.md` documents that stale-reset dirty refusal diagnostics name exact lossless inventory paths while untracked `.jarvis-*` harness sidecars and the materialized worktree-root `node_modules` symlink remain excluded.
- [ ] `v2/docs/v1-behaviors.md` records stale-reset dirty inventory semantics through the shared lossless inventory and names `listDirtyWorktreePathsForStaleReset` as the migrated cleanup source.

## Documentation updates

- `v2/docs/operator-runbook.md` — stale-reset dirty diagnostics use exact lossless paths while existing exclusions remain.
- `v2/docs/v1-behaviors.md` — stale-reset dirty inventory semantics and migrated source ownership.
