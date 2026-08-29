# Use the injected inventory for completion formatting

## Problem

Completion formatting enumerates changed paths with a local porcelain parser, so it can alter paths and bypass the completion committer's injected Git execution seam.

## Decisions

- Obtain completion-format paths through `getGitStatusInventory` using the committer's existing injected Git seam.
- Format exact current paths only; retain Biome eligibility filtering, deletion skips, timeout behavior, and staging order.
- Keep inventory inspection fail-closed for completion formatting.

## Tasks

- Migrate completion-format path enumeration in `v2/src/execution/completion-commit.ts` to the shared typed inventory without introducing a direct Git subprocess.
- Add injected-seam, lossless-path, and inspection-failure pins to `completion-commit.test.ts`, including a source `// @mutate` directive in the lossless formatter test.
- Update `v2/docs/write-behavior.md` with the shared lossless inventory used before completion formatting.

## Acceptance criteria

- [ ] `v2/src/execution/completion-commit.ts` obtains completion-format paths through `getGitStatusInventory` and the existing injected Git seam, projects exact `currentPath` values only, and contains no independent porcelain parser.
- [ ] `completion-commit.test.ts` test `completion formatting receives lossless status paths` supplies status through a custom injected Git implementation and proves each path with spaces, newlines, non-ASCII text, or leading/trailing whitespace reaches the formatter unchanged; it fails against the pre-fix parser or a bypassed seam.
- [ ] `completion-commit.test.ts` test `completion formatting fails when shared inventory inspection fails` pins fail-closed status inspection, while `formats changed files before staging so committed tree passes biome check`, `commits a markdown-only changed set without failing on biome-ineligible paths`, and `commits a deletion-only changed set without failing on the removed path` stay green.
- [ ] `completion-commit.test.ts` — `completion formatting receives lossless status paths`; Mutation checkpoint: the test body carries a source `// @mutate` directive that makes the migrated formatter current-path projection lossy, and the scoped test turns RED under that mutation.
- [ ] `v2/docs/write-behavior.md` documents the lossless all-files inventory used for completion formatting and its fail-closed inspection behavior.

## Documentation updates

- `v2/docs/write-behavior.md` — lossless all-files inventory at completion formatting.
