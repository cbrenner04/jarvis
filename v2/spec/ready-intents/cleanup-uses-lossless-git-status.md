---
name: cleanup-uses-lossless-git-status
---

# Cleanup uses lossless Git status inventory

## Prerequisites

- Shared Git tooling returns typed entries from `git status --porcelain=v1 -z --untracked-files=all`, preserving exact current and original paths.
- Review enforcement, completion formatting, and terminal dirty-worktree detection consume the shared inventory; nested untracked files are reported individually.

## Problem

- Stale-workspace cleanup uses the last independent porcelain path parser and can mangle valid path text.

Unsplit rationale: Stale-reset classification and diagnostics are one CLI boundary; its shared-inventory dependency and execution consumers are already isolated in earlier intents.

## Primary implementation surface

- cli

## Behavior

- Stale-workspace cleanup derives dirty paths and untracked status from shared typed entries.
- Cleanup preserves its clean, dirty, not-a-repository, and listing-error outcomes plus its untracked harness-sidecar and materialized `node_modules` exclusions.
- Dirty refusal diagnostics render exact current paths, including rename destinations and whitespace-bearing or non-ASCII names.

## Decisions

- Filter cleanup exceptions from typed status and path fields; rules out retaining raw status-prefix and rename-arrow slicing.
- Preserve cleanup's fail-closed non-empty-status behavior; rules out treating malformed or unrecognized inventory as clean.
- Add the repository guard after cleanup becomes the final migrated consumer; rules out a guard that passes while an earlier execution parser remains.

## Acceptance criteria

- [ ] `cleanup.test.ts` preserves stale-reset status classification and the untracked harness-sidecar and materialized `node_modules` exclusions while production uses the shared inventory.
- [ ] Cleanup reports rename destinations and whitespace/newline/non-ASCII paths without trimming or quote artifacts, pinned by a test that fails against the pre-fix parser.
- [ ] `cleanup.test.ts` — `listDirtyWorktreePathsForStaleReset reports lossless status paths`; Keystone checkpoint:
- [ ] `cleanup.test.ts` — `listDirtyWorktreePathsForStaleReset ignores a worktree holding only the materialized node_modules symlink`; Mutation checkpoint:
- [ ] A repository guard rejects `git status --porcelain` path-record splitting, status-prefix slicing, rename-arrow slicing, or path trimming in `v2/src/execution/review-intent-enforcement.ts`, `v2/src/execution/completion-commit.ts`, `v2/src/execution/write-loop.ts`, and `v2/src/commands/cleanup.ts`; it fails against main, where all four consumers still contain one of those reachable parsing forms.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — stale-reset dirty diagnostics use exact lossless paths while existing exclusions remain.
- `v2/docs/v1-behaviors.md` — update stale-reset dirty inventory semantics and migrated source ownership.
