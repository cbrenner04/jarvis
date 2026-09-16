---
name: pr-body-collapsed-attribution
---

# PR body collapsed attribution

## Prerequisites

- Implement PR bodies open with `## Overview` and carry no absolute spec path.

## Problem

Harness attribution leads the body and commits appear twice (issue #3934): footer `Written by <agent> through Jarvis` / `<agent> — Steps: …` (`pr-attribution.ts:167`, `:203`), per-commit `— <agent>` suffixes (`pr-attribution.ts:158`, `spec-run-body-summary.ts:39`), and `## Commits` (`spec-run-body-summary.ts:57`) duplicating the footer SHA list.

## Decisions

- Attribution renders inside one `<details><summary>Jarvis attribution</summary>` block holding the agent/steps lines and the single SHA commit list.
- `## Commits` removed; commits appear once, inside the block. No `— <agent>` suffix outside it.

## Acceptance criteria

- [ ] A test asserts each commit SHA appears exactly once in the body and `## Commits` is absent.
- [ ] A test asserts `Written by`, `— Steps:`, and per-commit agent labels appear only inside the `<details>` block.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` § Commit trailers and PR attribution — collapsed attribution, single commit list.
- `v2/docs/v1-behaviors.md` — note the change if it pins the old layout.
