---
name: cleanup-publishes-archive-pr
---

# Cleanup publishes its archive branch as a PR

## Problem

`jarvis cleanup` commits in-repo spec archives to a local `cleanup/archive-<stamp>` branch and stops with manual push/PR instructions. Unpushed archive branches block later cleanups via `already staged on cleanup branch …; push it and open the archive PR`.

## Decisions

- After a successful apply with at least one archive commit, cleanup pushes the session branch and opens one ready PR against the repository default branch using the completion publisher's shared push and open-or-reuse PR primitives (no parallel `gh` path).
- Idempotent: if an open PR already exists for the branch, reuse it and print its URL on stdout.
- A pre-existing local `cleanup/archive-*` branch with staged archives but no remote and no PR is published on the next cleanup apply instead of skip-only blocking.
- Push or PR failure does not undo local archive commits: print the failing step, print today's manual fallback, exit non-zero.
- `--dry-run` previews `push: <branch>` and `open PR: <title>` without network calls.
- Cleanup never merges; operator review stays manual.

## Prerequisites

- Completion publisher exposes callable push and open-or-reuse PR primitives that support ready (non-draft) archive PR creation and idempotent reuse of an existing open PR for the branch and default base.

## Acceptance criteria

- [ ] `cleanup-archive-publication.test.ts`: an apply that produced archive commits pushes the branch and calls `gh pr create` once with the default base; stdout names the PR URL; fails against current code (no push/PR).
- [ ] Same file: an existing open PR for the branch is reused (no second create).
- [ ] Same file: a pre-existing unpushed `cleanup/archive-*` branch carrying a staged archive is pushed and gets a PR on the next apply; fails against current "already staged" skip-only behavior.
- [ ] Same file: push failure keeps the local commits, prints the failing step plus the manual fallback, and exits non-zero.
- [ ] `cleanup.test.ts`: `--dry-run` prints the push/PR preview and makes no network call.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Merged-worktree retirement: cleanup opens the archive PR; operator reviews and merges it.
- `v2/docs/v1-behaviors.md`: record cleanup archive auto-publication and staged-branch recovery.

## Primary implementation surface

- `v2/src/commands/cleanup.ts`
