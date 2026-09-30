---
name: capture-pr-review-input
---

# Capture open-PR review threads into a durable artifact

## Problem

Review feedback on a published lane PR lives only on GitHub until an operator copies it by hand.

## Behavior

Before a review-feedback run, the harness reads the lane PR's review threads and inline comments through `gh` and writes one durable review artifact scoped to that lane. The PR is the only feedback source; operator or subagent verdicts outside the PR are not ingested.

## Acceptance criteria

- [ ] A regression test with a mocked `gh` fixture fails against absent capture and proves review threads and comments land in the durable artifact with stable item identities suitable for later traceability.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — where the review artifact is written and what it contains.

## Prerequisites

- The preset registry records whether each registered CLI workflow may be used as a pipeline stage `workflow` value, and pipeline definition validation rejects stage workflows marked standalone-only with a named error.
