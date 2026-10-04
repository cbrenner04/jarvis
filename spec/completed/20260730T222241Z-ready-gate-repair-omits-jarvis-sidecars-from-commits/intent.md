---
name: ready-gate-repair-omits-jarvis-sidecars-from-commits
---

# Ready-gate repair never publishes `.jarvis-*` harness sidecars

## Problem

Repair on PR #2243 committed `.jarvis-intent-review-verdict.md` and its `.owner` sidecar — local
harness artifacts that must not land on the branch.

## Decisions

- Ready-gate repair completion must not publish any path whose basename matches `.jarvis-*` — rules
  out treating sidecars as ordinary worktree files.
- A test asserts the post-repair published tree excludes `.jarvis-*` paths — rules out relying on
  operators to notice sidecars in the diff.

## Acceptance criteria

- [ ] A ready-gate repair attempt that would publish a `.jarvis-*` path does not; a test asserts the
      post-repair tree excludes `.jarvis-*` and fails if the exclusion is removed.
- [ ] In-scope repair without sidecars still commits and republishes as today.

## Documentation updates

- `v2/docs/write-behavior.md` — harness sidecars excluded from repair commits.

## Prerequisites

- Ready-gate repair completion validates staged paths against the run diff plus spec tree before commit.
