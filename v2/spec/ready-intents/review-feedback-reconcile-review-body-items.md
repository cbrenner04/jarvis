---
name: review-feedback-reconcile-review-body-items
---

# Review-feedback reconciliation tracks review-body items

## Problem

Settlement reconciliation builds captured id lists from thread `threadId` and top-level `commentId` only, so a run that addressed submitted review bodies still reports empty addressed/unaddressed buckets and operators cannot trace those items.

## Decisions

- Treat each captured review-body id like a top-level comment id when building addressed, declined, and unaddressed buckets from `.jarvis-review-feedback-response.md`.
- Artifact shape validation accepts the review-body array introduced by capture refresh; missing or legacy captures without that field reconcile as today.

## Acceptance criteria

- [ ] `review-feedback-item-reconciliation.test.ts`: a review-body item id appears in addressed or unaddressed buckets by id; fails against current code.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Review-feedback workflow: capture ids include submitted review-body review ids; settlement arrays use those ids.
- `v2/docs/v1-behaviors.md`: reconciliation buckets include review-body capture ids (additive traceability).

## Prerequisites

- `.jarvis-pr-review-input.json` refresh records non-empty submitted review bodies as review-level items with stable GitHub review ids and body text under the same bot and truncation guards as threads and top-level comments.
- Review-feedback write prompt instructs agents to sidecar review-body ids alongside thread and top-level comment ids.
