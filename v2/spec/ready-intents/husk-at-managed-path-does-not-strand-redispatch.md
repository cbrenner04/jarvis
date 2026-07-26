---
name: husk-at-managed-path-does-not-strand-redispatch
---

# Husk at managed path does not strand re-dispatch

## Problem

Retirement can leave an ordinary non-Git directory at the managed worktree path (observed:
one containing only `.claude/`). The next re-dispatch dies in the stale-reset dirty-worktree
preflight with `could not list worktree changes (fatal: not a git repository)`. That refusal's
named recovery — `jarvis cleanup --abandon <branch>` — cannot apply, because `--abandon` resolves
names only through materialized worktrees. Recovery required hand `rm -rf` plus `git worktree prune`.

Materialization already handles this: it removes a proven unregistered non-Git husk and
rematerializes under the same branch lock. The preflight refuses before that path is reached.

## Decisions

- The dirty-worktree preflight classifies a non-Git managed path as a husk and defers to the existing husk-removal path at materialization rather than refusing. Rules out leaving `rm -rf` as the operator's only route, and rules out merely rewording the refusal.
- Only the non-Git-repository case is reclassified; other `git status` failures keep refusing as today. Rules out treating every listing error as a husk.

## Acceptance criteria

- [ ] A re-dispatch against a managed path holding a non-Git husk does not fail in the dirty-worktree preflight; a test drives a husk path and asserts the run reaches materialization, and fails against the pre-fix code (`not a git repository`).
- [ ] A `git status` failure that is not a missing-repository error still refuses with its existing recovery text; a test asserts this.
- [ ] Existing `v2/src/commands/cleanup.test.ts` dirty-worktree gate tests stay green.

## Documentation updates

- `v2/docs/operator-runbook.md` § Worktrees and branches / Recovery — record husk-at-managed-path handling on re-dispatch.
- `v2/docs/v1-behaviors.md` — record the changed preflight classification.

## Prerequisites

- Materialization removes a proven unregistered non-Git directory at a managed worktree path and rematerializes under the same branch lock.
- The stale-reset dirty-worktree preflight refuses when `git status` fails in the managed worktree path.
