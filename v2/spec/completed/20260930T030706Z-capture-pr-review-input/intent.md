---
name: capture-pr-review-input
---

# Capture open-PR review threads into a durable artifact

## Problem

Review feedback on a published lane PR lives only on GitHub until an operator copies it by hand.

## Behavior

The harness exposes a capture library seam: a callable function that, given a resolved lane worktree and its open PR, reads review threads and inline comments through `gh` and writes or refreshes one durable review artifact scoped to that lane. Out of scope: review-feedback admission, preset wiring, and any operator command or flag that invokes capture (sibling lanes). The PR is the only feedback source; operator or subagent verdicts outside the PR are not ingested.

## Acceptance criteria

- [ ] A regression test with a mocked `gh` fixture fails against absent capture and proves review threads and comments land in the durable artifact with stable item identities suitable for later traceability.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — where the review artifact is written and what it contains.

## Prerequisites
