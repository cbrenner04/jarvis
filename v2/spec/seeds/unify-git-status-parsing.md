---
name: unify-git-status-parsing
---

# One safe `git status` helper; the dirty-worktree gate stops under-reporting

## Problem

Four divergent hand parsers of `git status --porcelain` exist (2026-08-29 review): `review-intent-enforcement.ts:59`, `completion-commit.ts:59`, `write-loop.ts:508`, `cleanup.ts:1603`. They disagree on rename handling (`indexOf` vs `lastIndexOf` on `" -> "`), prefix width, and trimming; none handle `core.quotePath` C-quoted non-ASCII paths; `.trim()` corrupts paths with leading/trailing spaces. Live bug: `getUncommittedPaths` (`write-loop.ts:508`) omits `--untracked-files=all`, so untracked files nested in an untracked directory collapse to one entry and `shouldFailTerminalCompletionForDirtyWorktree` under-reports — the dirty-worktree completion gate can pass a dirty tree. Only `write-loop.ts:655` and `ready-finalize.ts:656,672` already use the safe `-z` form.

## Decisions

- One shared helper parses `git status --porcelain=v1 -z --untracked-files=all` and returns typed entries (status, path, origPath for renames); all four sites migrate to it. Rules out per-site string slicing.
- `-z` output makes quotePath and whitespace handling moot; no `.trim()` on paths. Rules out locale/path-content corruption.
- Each migrated site keeps its current filtering semantics except the under-report: the completion gate now sees nested untracked files. Rules out silent behavior change beyond the named fix.

## Acceptance criteria

- [ ] The shared helper round-trips renames, paths with spaces/newlines/non-ASCII, and nested untracked files, pinned by unit tests.
- [ ] `shouldFailTerminalCompletionForDirtyWorktree` fails a worktree whose only dirt is a file inside an untracked directory, pinned by a test that fails against the current parser.
- [ ] The four call sites use the helper; no `--porcelain` parsing remains outside it, pinned by a grep-level guard.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/coding-standards.md` — git status parsing goes through the shared helper.
