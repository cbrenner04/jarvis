# Resolve the reviewed-intent workspace

Derive every reviewed-intent path from the split write step's workspace result.

## Decisions

- Use one external-worktree resolution result for review `cwd`, verdict path, staging path, and landing workspace — rules out mixing operator-checkout and worktree paths.
- Reuse the plan workflow's external-worktree resolution contract — rules out an intent-only resolver that drifts from configured Jarvis roots or git-disabled local paths.

## Tasks

- Derive reviewed-intent review paths from the split write step's resolved external-worktree configuration for git-enabled and git-disabled projects.
- Add focused builder coverage.

## Acceptance criteria

- [x] `buildReviewedIntentWorkflowSteps` obtains the review `cwd`, verdict path, staging path, and deferred landing workspace from one split-step resolution result for git-enabled projects, using the configured Jarvis-root worktree.
- [x] Git-disabled reviewed-intent runs obtain those paths from that one resolution result's local intent-work path.

## Documentation updates

- None; internal resolution contract with no operator-facing change.
