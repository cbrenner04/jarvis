---
name: publish-completed-run-draft-pr
---

# Publish a completed run as an idempotent draft PR

## Problem

A completed v2 run can have a harness-authored branch commit but still leaves
the branch local and has no review surface.

## Direction

After the completed-run commit boundary, publish the current external-worktree
branch and ensure it has an open draft PR. Use `git push -u origin <branch>` on
the first push and plain `git push` once upstream tracking exists. Resolve the
PR base from the run's existing `baseRef`.

PR creation is idempotent for the current branch's open PR only: reuse or
refresh that PR; ignore merged and closed history so branch reuse may create a
new draft. Gate GitHub operations on `gh` readiness. Apply the established
bounded transient retry behavior to push and `gh` mediation, with injectable
subprocess and retry seams.

## Decisions

- Publication follows the harness commit — rules out pushing uncommitted worktree state or opening a PR without its completion commit.
- PR identity is the current branch's open PR — rules out binding to closed or merged history and rules out repository-wide title matching.
- First push establishes upstream and later pushes use tracking — rules out always forcing an explicit refspec or assuming upstream already exists.
- `baseRef` is the PR base input — rules out a second default-branch lookup that can diverge from worktree creation.
- GitHub auth/connectivity failure stops publication — rules out reporting successful completion with an unpublished branch.

Deferred to first consumer: minimal draft PR title and initial narrative body — pin when the caller exposes its stable run/spec metadata.

## Documentation updates

- Extend the durable v2 PR lifecycle doc with push ordering, draft creation, idempotency, retries, and `gh` preflight behavior.
- Mark the ported push and draft-PR behaviors in `v2/docs/v1-behaviors.md`.

## Prerequisites

- Completed v2 runs create a harness-authored commit in the external worktree
