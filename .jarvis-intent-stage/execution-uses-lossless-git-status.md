---
name: execution-uses-lossless-git-status
---

# Execution paths use lossless Git status inventory

## Prerequisites

- Shared Git tooling returns typed entries from `git status --porcelain=v1 -z --untracked-files=all`, preserving exact current and original paths.

## Problem

- Review enforcement, completion formatting, and terminal dirty-worktree detection carry divergent path parsers.
- Terminal completion can miss the only dirty file when Git collapses an untracked directory.

## Behavior

- Review enforcement, completion formatting, and terminal dirty-worktree detection derive paths from the shared inventory.
- Terminal completion reports nested untracked files individually and fails when any non-excluded path remains without a completion commit.
- Each consumer retains its existing filtering and failure semantics, including the materialized `node_modules` exclusion.

## Decisions

- Migrate all three execution-library consumers together; rules out leaving two competing path protocols inside one module boundary.
- Expand nested untracked files only at the shared inventory boundary; rules out special-case directory traversal in the completion gate.
- Preserve consumer-specific filtering after typed parsing; rules out broadening review enforcement or formatting scope beyond the named under-report fix.

## Acceptance criteria

- [ ] `review-intent-enforcement.test.ts` and `completion-commit.test.ts` stay green while their production consumers use the shared inventory.
- [ ] A `write-loop.test.ts` Git fixture whose only dirt is a file inside an untracked directory makes terminal completion fail and names that file; the test fails against the pre-fix parser.
- [ ] Paths containing spaces, newlines, non-ASCII text, or leading/trailing whitespace reach execution consumers unchanged, pinned by tests.
- [ ] The execution-library call sites contain no porcelain path-record slicing or trimming.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — lossless all-files inventory at completion formatting and the no-commit dirty gate.
- `v2/docs/workflow-runner.md` — reviewed-intent boundary enforcement uses the shared lossless inventory.
- `v2/docs/v1-behaviors.md` — record the nested-untracked completion-gate behavior and migrated execution sources.
