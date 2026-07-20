---
name: abort-on-worktree-materialization-failure
---
# Abort on worktree materialization failure

## Outcome

- A workflow stops before agent invocation and routing reads when its managed worktree cannot be created or fails post-creation validation.
- The operator-facing failure identifies worktree materialization and preserves the underlying Git error; rules out reporting a downstream missing-index error.

## Decisions

- Validate the created worktree before invoking the workflow callback; rules out treating a successful subprocess return alone as proof of materialization.
- Propagate materialization failures from the daemon start request; rules out converting them to `routing_read_failed`.

## Durable documentation

- Update daemon/workflow operator semantics and the v1 behavior catalog in the same subspec.

## Prerequisites
