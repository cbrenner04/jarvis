---
name: ready-gate-repair-omits-jarvis-sidecars-from-commits
---

# Ready-gate repair never publishes `.jarvis-*` harness sidecars

## Problem

Repair on PR #2243 committed `.jarvis-intent-review-verdict.md` and its `.owner` sidecar — local
harness artifacts that must not land on the branch.

## Decisions

- Any staged path whose basename matches `.jarvis-*` is stripped or rejected before a ready-gate
  repair completion commit. Rules out treating sidecars as ordinary worktree files.
- The published branch head after a successful repair contains no `.jarvis-*` paths. Rules out
  relying on operators to notice sidecars in the diff.

## Acceptance criteria

- [ ] A ready-gate repair attempt that leaves a `.jarvis-*` file staged does not publish it; a test
      asserts the post-repair tree excludes `.jarvis-*` and fails if the exclusion is removed.
- [ ] In-scope repair without sidecars still commits and republishes as today.

## Documentation updates

- `v2/docs/write-behavior.md` — harness sidecars excluded from repair commits.

## Prerequisites

- Ready-gate repair completion validates staged paths before commit.
