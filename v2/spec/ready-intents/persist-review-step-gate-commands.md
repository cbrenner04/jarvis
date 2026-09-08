---
name: persist-review-step-gate-commands
---

# Persist Review-Step Gate Commands

## Module-boundary surface

Persistence.

## Problem

Workflow snapshots serialize `readyCommand` and `fixCommand` only inside the write-step branch, so a durable review or review-debate row cannot retain the commands admitted for its project.

## Behavior

Persist and reload resolved gate commands on review and review-debate snapshot rows so continuation uses the dispatch-time values even if live project config later changes.

## Prerequisites

- Workflow admission stamps configured `readyCommand` and `fixCommand` onto write, review, and review-debate steps while leaving absent overrides unstamped.

## Decisions

- Review and review-debate snapshots retain their own resolved gate commands; rules out re-reading mutable machine config or borrowing a write sibling during continuation.
- Legacy snapshots without gate-command fields remain readable; rules out a migration requirement for existing runs.

## Acceptance criteria

- [ ] A snapshot round-trip regression proves a review and a review-debate row retain configured `readyCommand` and `fixCommand` values through state-store persistence and reload; it fails against the pre-fix write-only snapshot branch.
- [ ] A continuation reconstruction test proves the persisted review-row values remain available after live config changes.
- [ ] Legacy snapshots without the fields continue to load.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — add review-row gate commands to the dispatch-time snapshot fields preserved across continuation.
- `v2/docs/v1-behaviors.md` — update the v2 parity entry for persisted review-step gate commands.
