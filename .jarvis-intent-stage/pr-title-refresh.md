---
name: pr-title-refresh
---

# PR title refresh

## Prerequisites

- Implement PR bodies open with `## Overview` and carry no absolute spec path.
- Implement PR body attribution renders in a single collapsed `<details>` block with one commit list.

## Problem

PR title is set once at `gh pr create` (`completion-publisher.ts:280`, resolver `spec-creation-title.ts:30`); `refreshPrBody` never updates it, so a renamed plan keeps the old title (issue #3934).

## Decisions

- Body refresh re-derives the title with the creation resolver and runs `gh pr edit --title` only when it differs; an explicit title still wins.

## Acceptance criteria

- [ ] A test on the fake `gh` asserts refresh issues `pr edit --title <new>` when the resolved title changed and none when unchanged.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` § Commit trailers and PR attribution — title refresh.
