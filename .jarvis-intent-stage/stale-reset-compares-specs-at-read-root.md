---
name: stale-reset-compares-specs-at-read-root
---

# Compare stale-reset criteria at the spec tree's read root

## Problem

`resetStaleWorkspace` can compare landed criteria only when the spec path is readable under the code project root. A spec tree in an external home or prior-stage worktree is discarded as untrackable, so gate 2 cannot distinguish unticked base criteria from newly ticked current criteria.

## Primary implementation surface

- `v2/src/commands/cleanup.ts`

## Decisions

- Let gate 2 describe the spec tree's current read root independently from the code worktree and compare the tree against the matching Git base from that location.
- Refuse retirement with a named reason when the current tree, linked subspecs, Git root, or base snapshot cannot be read. Inconclusive comparison is not permission to destroy.
- Keep in-project comparison behavior and `--reset-despite-landed-criteria`; the override bypasses only gate 2, including its inconclusive refusal.
- Do not extend out-of-root tracking to continuation tick-backing or change gates 1 and 3, committed-lane continuation, or `cleanup --abandon`.

## Acceptance criteria

- [ ] A `v2/src/commands/cleanup.test.ts` regression places a linked spec tree outside the code project root, ticks a subspec only in the current tree, and proves gate 2 refuses retirement naming that subspec; it fails against the current out-of-root early return.
- [ ] A test proves an unreadable or otherwise incomparable spec tree refuses retirement with a named reason and no retirement mutation.
- [ ] Existing in-project landed-criteria tests stay green, and tests prove `--reset-despite-landed-criteria` bypasses only gate 2 for both in-project and out-of-root trees.
- [ ] Tests pin that gates 1 and 3, continuation tick-backing, and `cleanup --abandon` are unchanged.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None. This intent adds the internal comparison capability; production routing and operator semantics belong to the dependent intent.

## Prerequisites
