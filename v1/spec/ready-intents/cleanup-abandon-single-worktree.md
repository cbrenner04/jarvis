---
name: cleanup-abandon-single-worktree
---

# Scoped single-worktree abandon

## Problem

`jarvis1 cleanup --abandon` scans every `.worktree/*` entry. A dry run can list unrelated abandoned worktrees, so the command is unsafe when the operator needs to retire exactly one stale tree after triage.

## Desired behavior

`jarvis1 cleanup --abandon <worktree-name>` retires only the named worktree using the same abandon semantics as today (close one matching draft PR best-effort, force-remove worktree, delete local and remote branch, no spec archival). Before confirmation or removal, print the target worktree path and branch. Refuse with a clear error when the name is unknown, a ready/non-draft PR matches, multiple open PRs match, or a live `.jarvis.lock` is held. Omitting `<worktree-name>` keeps current global abandon behavior unchanged. `--dry-run` previews only the named target when provided.

## Decisions

- Extend `cleanup --abandon` with an optional positional worktree name — rules out a new top-level command and `jarvis1 triage <worktree-name> --abandon`.
- Omitting the positional keeps the existing global scan — rules out requiring a name on every abandon invocation.
- Refuse on a live worktree lock — rules out retiring a tree while a run holds `.jarvis.lock`.
- Reuse existing abandon eligibility and retire helpers for the named target — rules out a parallel abandon implementation with different PR/branch semantics.
- Deferred to first consumer: confirmation prompt shape for a single named target — pin when CLI UX is drafted.

## Documentation updates

- `v2/docs/v1-behaviors.md` — scoped abandon surface, guards, and global-mode preservation.
- CLI help/usage for `cleanup`.

## Prerequisites
