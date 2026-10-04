# 05 — Cleanup archive-publication git adapter

## Problem

`applyEndArchivePublication` in `cleanup.ts` wraps `runner.runAsync("git", …)` in a local `git` callback passed to `publishArchiveReady`, bypassing typed push/ref operations.

## Decisions

- Replace the callback with calls to `pushBranch`, `resolveRef`, `mergeBase`, and other existing or [02](./02-shared-git-reads-for-cleanup.md) git exports that `publishArchiveReady` needs for archive lanes — rules out passing a stringly `git(args)` function into `publishArchiveReady` from cleanup.
- `publishArchiveReady` keeps its injectable seam; only the cleanup-supplied adapter changes — rules out rewriting completion-publisher archive flow in this subspec.
- Push-step vs PR-step failure discrimination keeps the `ArchivePublicationStepFailure` `pastPush` flag behavior — rules out losing operator stderr that names whether push or PR failed.
- Network git pushes use the same `networkSubprocessOptions` as `pushBranch` already applies — rules out a second timeout/env policy in cleanup.
- Archive publication `gh` delegation is owned by [00](./00-cleanup-delegates-github-pr.md); this subspec is git-only — rules out duplicating GitHub migration tasks here.

## Task checklist

- Reimplement the `git` adapter inside `applyEndArchivePublication` using typed git exports; remove the inner `runAsync("git"` wrapper.
- Extend `cleanup.test.ts` archive-publication integration mocks if they currently assert raw `git push` argv from cleanup's adapter.
- Ensure `archivePublicationCommitCount` uses the [02](./02-shared-git-reads-for-cleanup.md) commit-count export if it still inline-spawns `rev-list`.

## Acceptance criteria

- [x] `cleanup.test.ts` archive-publication tests that exercise end-to-end `applyEndArchivePublication` (search `mergeArchivePublicationRunner` / archive PR stdout cases) stay green after adapter migration.
- [x] `cleanup.ts` contains no `runAsync("git"` inside `applyEndArchivePublication` — reachable on main today via the local `git` async wrapper (~line 1543); staging slice only; full-file invariant is [06](./06-cleanup-operation-errors-and-docs.md).
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- Deferred to [06 — Cleanup operation errors and docs](./06-cleanup-operation-errors-and-docs.md).
