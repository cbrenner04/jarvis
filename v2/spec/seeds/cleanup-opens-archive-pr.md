---
name: cleanup-opens-archive-pr
---

# Cleanup publishes its archive branch as a PR

## Problem

`jarvis cleanup` commits in-repo spec archives to a local `cleanup/archive-<stamp>` branch and stops: `reportArchiveSessions` (`v2/src/commands/cleanup.ts` ~:1406) prints `push it and open one archive PR`. The push and PR are a manual operator step that is easy to miss. Later cleanups then skip those specs as `already staged on cleanup branch …; push it and open the archive PR` (`cleanup-archive-publication.ts` ~:173), so the unpushed branch blocks archival indefinitely.

## Evidence

- 2026-10-02: two cleanup runs left `cleanup/archive-20261001T233724Z` (3 commits) and `cleanup/archive-20261002T040513Z` (2 commits) local and unpushed; 16 completed specs sat in `v2/spec/`. Operator hand-built #4420 and deleted both branches.

## Decisions

- After a successful apply with ≥1 archive commit, cleanup pushes the session branch and opens one PR against the repository default branch (non-draft: the archive is complete when created). Reuse the completion publisher's push and `gh pr create` helpers rather than a new path.
- Idempotent: if an open PR already exists for the branch, reuse it and print its URL.
- A staged `cleanup/archive-*` branch from an earlier run that has no remote and no PR is published the same way on the next cleanup, instead of only blocking with "already staged".
- Push or PR failure (offline, `gh` unreachable in a sandbox) does not undo the local archive commits: print the failing step and fall back to today's manual instruction; exit non-zero.
- `--dry-run` previews `push: <branch>` / `open PR: <title>` without network calls.
- Merging stays manual (operator review); cleanup never merges.

## Acceptance criteria

- [ ] `cleanup-archive-publication.test.ts`: an apply that produced archive commits pushes the branch and calls `gh pr create` once with the default base; stdout names the PR URL; fails against current code (no push/PR).
- [ ] Same file: an existing open PR for the branch is reused (no second create).
- [ ] Same file: a pre-existing unpushed `cleanup/archive-*` branch carrying a staged archive is pushed and gets a PR on the next apply; fails against current "already staged" skip-only behavior.
- [ ] Same file: push failure keeps the local commits, prints the failing step plus the manual fallback, and exits non-zero.
- [ ] `cleanup.test.ts`: `--dry-run` prints the push/PR preview and makes no network call.
- [ ] `bun run typecheck`, `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Merged-worktree retirement: cleanup opens the archive PR; operator reviews and merges it.
- `v2/docs/v1-behaviors.md`: record.
